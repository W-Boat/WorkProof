package com.scaffold.system.controller;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class OfficeBootstrapControllerTest {
    @Test void manifestsUseConfiguredInstitutionOrigin() {
        var response = new OfficeBootstrapController("https://workproof.example:8443/").wordManifest();
        assertEquals(200, response.getStatusCode().value());
        assertTrue(response.getBody().contains("https://workproof.example:8443/office/index.html"));
        assertFalse(response.getBody().contains("127.0.0.1"));
    }
    @Test void refusesMissingOrUnsafeOrigins() {
        for (String value : new String[]{"", "http://example.com", "https://user@example.com", "https://example.com/other", "https://example.com?x=1", "https://example.com#fragment"}) {
            assertEquals(503, new OfficeBootstrapController(value).wordManifest().getStatusCode().value(), value);
        }
    }
}
