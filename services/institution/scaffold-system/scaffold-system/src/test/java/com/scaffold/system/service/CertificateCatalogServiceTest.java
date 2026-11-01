package com.scaffold.system.service;
import com.scaffold.common.domain.PageQuery;
import com.scaffold.common.exception.ServiceException;
import com.scaffold.framework.datascope.DataScopeContext;
import com.scaffold.system.mapper.CertificateCatalogMapper;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class CertificateCatalogServiceTest {
    @Test void enabledButIncompleteSchemaRefusesStorage() {
        var mapper=mock(CertificateCatalogMapper.class);var inspector=mock(NativeCertificateInspector.class);
        var service=new CertificateCatalogService(mapper,inspector,mock(AuthService.class),true);
        assertFalse(service.status().ready());
        assertThrows(ServiceException.class,()->service.save(new java.io.ByteArrayInputStream(new byte[0])));
        verifyNoInteractions(inspector);
    }
    @Test void disabledCatalogNeverTouchesDatabaseOrVerifier() {
        var mapper=mock(CertificateCatalogMapper.class);var inspector=mock(NativeCertificateInspector.class);
        var service=new CertificateCatalogService(mapper,inspector,mock(AuthService.class),false);
        assertThrows(ServiceException.class,()->service.list(new PageQuery(1,10,null,null),null,null));
        verifyNoInteractions(mapper,inspector);
    }
    @Test void missingScopeContextDeniesAccessInsteadOfGrantingAll() {
        DataScopeContext.clear();
        assertFalse(DataScopeContext.required().isAllScope());
        assertNull(DataScopeContext.required().getUserId());
        assertTrue(DataScopeContext.required().getDeptIds().isEmpty());
    }
}
