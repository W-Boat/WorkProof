package com.scaffold.framework.audit;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.aspectj.lang.ProceedingJoinPoint;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class OperationLogPrivacyTest {
    @OperLog(module = "证书核验", action = "内容检查", recordParams = false)
    public void sensitive() { }

    @OperLog(module = "普通操作", action = "检查")
    public void normal() { }

    @Test void certificateContentIsNeverReadByAuditSerialization() throws Throwable {
        var entries = new ArrayList<OperationLogEntry>();
        var aspect = new OperationLogAspect(entries::add, new ObjectMapper());
        var point = mock(ProceedingJoinPoint.class); when(point.proceed()).thenReturn("ok");
        var annotation = getClass().getMethod("sensitive").getAnnotation(OperLog.class);
        assertEquals("ok", aspect.record(point, annotation));
        verify(point, never()).getArgs(); assertEquals("[]", entries.get(0).requestParams()); assertEquals(1, entries.get(0).result());
    }

    @Test void ordinaryAuditStillRecordsParamsAndMasksSecrets() throws Throwable {
        var entries = new ArrayList<OperationLogEntry>();
        var aspect = new OperationLogAspect(entries::add, new ObjectMapper());
        var point = mock(ProceedingJoinPoint.class); when(point.proceed()).thenReturn("ok");
        when(point.getArgs()).thenReturn(new Object[]{Map.of("label", "visible", "password", "private-value")});
        aspect.record(point, getClass().getMethod("normal").getAnnotation(OperLog.class));
        assertTrue(entries.get(0).requestParams().contains("visible")); assertFalse(entries.get(0).requestParams().contains("private-value"));
    }
}
