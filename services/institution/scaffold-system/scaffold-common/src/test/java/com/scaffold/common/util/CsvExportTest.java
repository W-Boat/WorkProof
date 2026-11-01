package com.scaffold.common.util;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
class CsvExportTest {
    @Test void protectsUntrustedSpreadsheetTextAndQuotes() {
        String value=CsvExport.encode(List.of("文件名","备注"),List.of(List.of(" =HYPERLINK(\"x\")","a,b\nnext")));
        assertTrue(value.contains("' =HYPERLINK"));
        assertTrue(value.contains("\"a,b\nnext\""));
        assertTrue(value.contains("\"\"x\"\""));
    }
}
