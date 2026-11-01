import { downloadBlob } from './download.ts'

export interface CsvColumn<T = Record<string, unknown>> {
  title: string
  key?: keyof T | string
  value?: (row: T) => unknown
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]) {
  const header = columns.map(column => escapeCell(column.title)).join(',')
  const body = rows.map(row => columns.map(column => {
    const value = column.value ? column.value(row) : column.key ? (row as Record<string, unknown>)[String(column.key)] : ''
    return escapeCell(value)
  }).join(','))
  return [header, ...body].join('\n')
}

export function downloadCsv<T>(filename: string, columns: CsvColumn<T>[], rows: T[]) {
  const blob = new Blob(['\ufeff', toCsv(columns, rows)], { type: 'text/csv;charset=UTF-8' })
  downloadBlob(blob, filename)
}

function escapeCell(value: unknown) {
  if (value == null) return ''
  let text = String(value)
  if (typeof value === 'string' && (/^[\s]*[=+\-@]/.test(text) || /^[\t\r]/.test(text))) text = "'" + text
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}
