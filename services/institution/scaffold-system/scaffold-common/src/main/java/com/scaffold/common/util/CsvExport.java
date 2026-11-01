package com.scaffold.common.util;

import java.util.List;

/** Shared CSV encoding, including spreadsheet formula protection for untrusted text. */
public final class CsvExport {
    private CsvExport() {}
    public static String encode(List<String> headers, List<List<Object>> rows) {
        StringBuilder output = new StringBuilder();
        output.append(headers.stream().map(CsvExport::cell).collect(java.util.stream.Collectors.joining(","))).append('\n');
        for (List<Object> row : rows) {
            for (int i=0;i<row.size();i++) {
                if (i>0) output.append(',');
                output.append(cell(row.get(i)));
            }
            output.append('\n');
        }
        return output.toString();
    }
    private static String cell(Object value) {
        String text = value == null ? "" : String.valueOf(value);
        String first = text.stripLeading();
        if (!first.isEmpty() && "=+-@".indexOf(first.charAt(0))>=0 || text.startsWith("\t") || text.startsWith("\r")) text="'"+text;
        if (text.contains(",") || text.contains("\"") || text.contains("\n") || text.contains("\r")) return "\""+text.replace("\"","\"\"")+"\"";
        return text;
    }
}
