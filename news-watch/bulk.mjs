export const IMPORT_FIELDS = {
  name: ['company name','name','vendor name','supplier name','watch name'],
  kind: ['kind','type','watch type'],
  category: ['category'],
  ticker: ['ticker','stock ticker'],
  exchange: ['exchange'],
  sec_cik: ['sec cik','cik'],
  website: ['website','official website'],
  vendor_id: ['vendor id','vendor number'],
  criticality: ['criticality'],
  objective: ['objective','monitoring objective'],
  frequency: ['frequency','schedule'],
  recipients: ['email to','email recipients','distribution list'],
  recipients_cc: ['email cc','cc'],
  active: ['active','enabled'],
};

export function parseCsv(source) {
  const rows = [];
  let row = [], value = '', quoted = false;
  const input = source.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '"') {
      if (quoted && input[i+1] === '"') {value += ch; i++;}
      else quoted = !quoted;
    } else if (!quoted && [',','\r','\n'].includes(ch)) {
      row.push(value);
      value = '';
      if (ch === ',') continue;
      if (ch === '\r' && input[i+1] === '\n') i++;
      rows.push(row);
      row = [];
    } else value += ch;
  }
  if (quoted) throw Error('Unclosed CSV quote');
  if (value || row.length) rows.push([...row,value]);
  return rows;
}

export function suggestMapping(headers) {
  const names = headers.map(h => String(h || '').trim().toLowerCase());
  return Object.fromEntries(Object.entries(IMPORT_FIELDS).map(([key, labels]) =>
    [key, names.findIndex(name => labels.includes(name))]));
}

export function validateRows(rows, mapping, defaults, existing, updateDuplicates) {
  const seen = new Set();
  return rows.map((row, i) => {
    const values = Object.fromEntries(Object.entries(mapping).filter(([,col]) => col >= 0)
      .map(([key,col]) => [key,String(row[col] ?? '').trim()]));
    if (!Object.values(values).some(Boolean)) return {row:i+2,status:'skip',issue:'Empty row'};
    const name = values.name || '';
    const kind = (values.kind || 'company').toLowerCase();
    const frequency = (values.frequency || defaults.frequency).toLowerCase();
    const activeValue = values.active?.toLowerCase();
    const active = activeValue ? ['true','yes','y','1','active','enabled'].includes(activeValue) : defaults.active;
    const key = kind+'\u0000'+name.toLowerCase();
    let issue;
    if (!name || name.length > 300) issue = 'Name must be 1–300 characters';
    else if (!['company','topic','event'].includes(kind)) issue = 'Unknown watch type';
    else if (!['manual','daily','weekly','monthly','6h'].includes(frequency)) issue = 'Unknown frequency';
    else if (values.sec_cik && !/^\d{1,10}$/.test(values.sec_cik)) issue = 'Invalid SEC CIK';
    else if (activeValue && ![true, false].some(x=>x ? active : ['false','no','n','0','inactive','disabled'].includes(activeValue))) issue = 'Invalid activation value';
    else if (Object.values(values).some(value=>value.length>1000)) issue = 'A mapped value exceeds 1,000 characters';
    else if (seen.has(key)) return {row:i+2,name,status:'skip',issue:'Duplicate in file'};
    if (issue) return {row:i+2,name,status:'invalid',issue};
    seen.add(key);
    const duplicate = existing.has(key);
    if (duplicate && !updateDuplicates) return {row:i+2,name,status:'skip',issue:'Existing watch'};
    return {row:i+2,name,status:duplicate?'update':'ready',
      values:{...values,name,kind,category:values.category||defaults.category,frequency,active}};
  });
}

export function validateXlsxArchive(buffer) {
  const bytes = new DataView(buffer);
  let end = bytes.byteLength - 22;
  const minOffset = Math.max(0, end - 65535);
  while (end >= minOffset && bytes.getUint32(end,true) !== 0x06054b50) end--;
  if (end < minOffset || bytes.getUint16(end+4,true) || bytes.getUint16(end+6,true)
      || end+22+bytes.getUint16(end+20,true)!==bytes.byteLength) throw Error('Unsupported XLSX archive');
  const entries = bytes.getUint16(end+10,true);
  let offset = bytes.getUint32(end+16,true), total = 0;
  if (entries > 200 || offset+bytes.getUint32(end+12,true)!==end) throw Error('Workbook contains too many entries');
  for (let i=0;i<entries;i++) {
    if (offset+46>end || bytes.getUint32(offset,true)!==0x02014b50) throw Error('Invalid workbook directory');
    total += bytes.getUint32(offset+24,true);
    if (total>20_000_000 || bytes.getUint16(offset+8,true)&1) throw Error('Workbook is encrypted or expands beyond 20 MB');
    offset += 46+bytes.getUint16(offset+28,true)+bytes.getUint16(offset+30,true)+bytes.getUint16(offset+32,true);
  }
  if (offset!==end) throw Error('Invalid workbook directory size');
}

let excelLibrary;
function loadExcelLibrary() {
  if (!excelLibrary) excelLibrary = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    script.integrity = 'sha384-Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz';
    script.crossOrigin = 'anonymous';
    script.onload = () => globalThis.ExcelJS ? resolve(globalThis.ExcelJS) : reject(Error('Excel reader is unavailable'));
    script.onerror = () => reject(Error('Excel reader could not load'));
    document.head.append(script);
  }).catch(error => {excelLibrary = null; throw error;});
  return excelLibrary;
}

export async function readImportFile(file) {
  if (file.size > 2_000_000) throw Error('Maximum file size is 2 MB');
  if (/\.csv$/i.test(file.name)) return parseCsv(await file.text());
  if (!/\.xlsx$/i.test(file.name)) throw Error('Choose a CSV or XLSX file');
  const buffer = await file.arrayBuffer();
  validateXlsxArchive(buffer);
  const Excel = await loadExcelLibrary();
  const workbook = new Excel.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount > 1001 || worksheet.columnCount > 80) {
    throw Error('Use a first worksheet with up to 1,000 data rows and 80 columns');
  }
  const rows = [];
  for (let r=1;r<=worksheet.rowCount;r++) {
    const row=worksheet.getRow(r), values=[];
    for (let c=1;c<=worksheet.columnCount;c++) {
      const cell=row.getCell(c);
      if (cell.type===Excel.ValueType.Formula) throw Error('Replace spreadsheet formulas with values before importing');
      values.push(cell.text);
    }
    rows.push(values);
  }
  return rows;
}
