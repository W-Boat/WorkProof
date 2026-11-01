package com.scaffold.system.service;
import com.scaffold.common.exception.BusinessException;
import com.scaffold.framework.audit.OperationLogRecorder;
import com.scaffold.framework.security.PermissionResolver;
import com.scaffold.system.mapper.*;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import javax.sql.DataSource;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.*;
class CertificateJobServiceTest{
 @Test void disabledDoesNotTouchDatabaseAuthOrInspector(){
  var db=mock(JdbcTemplate.class);var auth=mock(AuthService.class);var inspector=mock(NativeCertificateInspector.class);
  var service=new CertificateJobService(false,"",false,mock(OperationLogRecorder.class),db,mock(PlatformTransactionManager.class),mock(DataSource.class),auth,mock(AuthMapper.class),mock(PermissionResolver.class),mock(CertificateCatalogService.class),mock(CertificateCatalogMapper.class),inspector);
  assertEquals(false,service.capabilities().get("ready"));verifyNoInteractions(db,auth,inspector);service.close();
 }
 @Test void identifiersCannotBecomePaths(){for(String value:new String[]{"../secret","UPPER","","123"})assertThrows(BusinessException.class,()->CertificateJobService.uuid(value));}
}
