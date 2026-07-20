declare module "xlsx-populate" {
  interface Cell { value(value: unknown): Cell; style(name: string | Record<string, unknown>, value?: unknown): Cell; }
  interface Sheet { name(value: string): Sheet; cell(row: number, column: number): Cell; usedRange(): { style(name: string | Record<string, unknown>, value?: unknown): unknown }; column(index: number): { width(value: number): unknown }; }
  interface Workbook { sheet(index: number): Sheet; outputAsync(): Promise<Buffer>; }
  const XlsxPopulate: { fromBlankAsync(): Promise<Workbook> };
  export default XlsxPopulate;
}
