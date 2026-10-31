package com.scaffold.system.controller;

import java.net.URI;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/** Public host installation metadata; contains no accounts, tokens or document data. */
@RestController
public class OfficeBootstrapController {
    private final String publicOrigin;
    public OfficeBootstrapController(@Value("${workproof.public-origin:${WORKPROOF_PUBLIC_ORIGIN:}}") String publicOrigin) {
        this.publicOrigin = publicOrigin;
    }
    @GetMapping(value="/office/manifest-word.xml", produces="application/xml;charset=UTF-8")
    public ResponseEntity<String> wordManifest() {
        String origin = validatedOrigin();
        if (origin == null) return ResponseEntity.status(503).body("<!-- 请先配置有效的 WORKPROOF_PUBLIC_ORIGIN（机构 HTTPS 来源地址） -->");
        String location = xml(origin + "/office/index.html");
        String manifest = """
            <?xml version="1.0" encoding="UTF-8"?>
            <OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1"
                       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="TaskPaneApp">
              <Id>9ebd5d58-80c3-4868-8dd5-c3f3c53d7942</Id><Version>0.2.0.0</Version>
              <ProviderName>WorkProof</ProviderName><DefaultLocale>zh-CN</DefaultLocale>
              <DisplayName DefaultValue="WorkProof · 开源证人"/>
              <Description DefaultValue="在本机记录文档过程并导出可核验证书"/>
              <Hosts><Host Name="Document"/></Hosts>
              <DefaultSettings><SourceLocation DefaultValue="%s"/></DefaultSettings>
              <Permissions>ReadWriteDocument</Permissions>
            </OfficeApp>
            """.formatted(location);
        return ResponseEntity.ok().header("Cache-Control", "no-store").body(manifest);
    }
    private String validatedOrigin() {
        try {
            URI uri = URI.create(publicOrigin);
            if (!"https".equals(uri.getScheme()) || uri.getHost() == null || uri.getRawUserInfo() != null
                || uri.getRawQuery() != null || uri.getRawFragment() != null
                || !(uri.getPath().isEmpty() || "/".equals(uri.getPath()))) return null;
            return "https://" + uri.getRawAuthority();
        } catch (IllegalArgumentException error) { return null; }
    }
    private static String xml(String value) {
        return value.replace("&", "&amp;").replace("\"", "&quot;").replace("<", "&lt;").replace(">", "&gt;").replace("'", "&apos;");
    }
}
