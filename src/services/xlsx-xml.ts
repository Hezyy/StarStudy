import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import type { ExcelSheet } from './excel';
type Node = Record<string, unknown>;
const obj = (v: unknown): Node =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Node) : {};
const list = (v: unknown): unknown[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const text = (v: unknown): string =>
  typeof v === 'string' || typeof v === 'number'
    ? String(v)
    : list(obj(v).t ?? obj(v).r ?? obj(v)['#text'])
        .map(text)
        .join('');
export async function hasPrefixedWorkbook(bytes: ArrayBuffer) {
  const zip = await JSZip.loadAsync(bytes),
    file = zip.file('xl/workbook.xml');
  if (!file) throw new Error('工作簿缺少xl/workbook.xml');
  const xml = await file.async('string');
  if (xml.length > 1_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error('工作簿结构过大或包含不支持的实体声明');
  return /<\w[\w.-]*:workbook\b/.test(xml);
}
export async function readXmlWorkbook(bytes: ArrayBuffer): Promise<ExcelSheet[]> {
  const zip = await JSZip.loadAsync(bytes);
  let expanded = 0;
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '',
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    processEntities: false,
  });
  const xml = async (path: string) => {
    const f = zip.file(path);
    if (!f) throw new Error(`工作簿缺少 ${path}`);
    const s = await f.async('string');
    expanded += s.length;
    if (expanded > 40_000_000 || /<!DOCTYPE|<!ENTITY/i.test(s))
      throw new Error('工作簿 XML 过大或包含不支持的实体声明');
    return obj(parser.parse(s));
  };
  const book = obj((await xml('xl/workbook.xml')).workbook);
  const rels = list(obj((await xml('xl/_rels/workbook.xml.rels')).Relationships).Relationship).map(
    obj,
  );
  const shared = zip.file('xl/sharedStrings.xml')
    ? list(obj((await xml('xl/sharedStrings.xml')).sst).si).map(text)
    : [];
  const date1904 = ['1', 'true'].includes(String(obj(book.workbookPr).date1904));
  const sheets: ExcelSheet[] = [];
  let total = 0;
  for (const sheet of list(obj(book.sheets).sheet).map(obj)) {
    const rel = rels.find((r) => r.Id === sheet.id);
    if (!rel || rel.TargetMode === 'External') throw new Error('工作表关联无效');
    let path = String(rel.Target);
    path = path.startsWith('/') ? path.slice(1) : `xl/${path}`;
    if (path.includes('..') || !path.startsWith('xl/')) throw new Error('工作表路径无效');
    const xmlRows = list(obj(obj((await xml(path)).worksheet).sheetData).row).map(obj);
    if (xmlRows.length > 10000) throw new Error('工作表超过10000行');
    const rows: string[][] = [],
      numbers: number[] = [];
    let width = 0;
    for (const row of xmlRows) {
      const values: string[] = [];
      for (const cell of list(row.c).map(obj)) {
        const letters = String(cell.r).match(/^[A-Z]+/i)?.[0];
        if (!letters) continue;
        const col =
          letters
            .toUpperCase()
            .split('')
            .reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
        if (col >= 100) throw new Error('工作表超过100列');
        values[col] =
          cell.t === 's'
            ? (shared[Number(cell.v)] ?? '')
            : cell.t === 'inlineStr'
              ? text(cell.is)
              : text(cell.v);
        width = Math.max(width, col + 1);
      }
      if (values.some(Boolean)) {
        rows.push(values);
        numbers.push(Number(row.r));
        total++;
      }
    }
    if (rows.length > 1) {
      const headers = Array.from({ length: width }, (_, i) => rows[0][i] ?? '');
      sheets.push({
        name: String(sheet.name),
        headers,
        rows: rows.slice(1).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? '')),
        rowNumbers: numbers.slice(1),
        date1904,
      });
    }
  }
  if (total > 30000 || !sheets.length) throw new Error('未找到有效表格或工作簿超过30000行');
  return sheets;
}
