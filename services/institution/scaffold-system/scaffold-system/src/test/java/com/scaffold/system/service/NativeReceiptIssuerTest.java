package com.scaffold.system.service;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.scaffold.common.exception.ServiceException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.api.condition.EnabledOnOs;
import org.junit.jupiter.api.condition.OS;
import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.io.ByteArrayInputStream;
import static org.junit.jupiter.api.Assertions.*;
@EnabledOnOs({OS.LINUX,OS.MAC})
class NativeReceiptIssuerTest {
    @TempDir Path directory;
    private NativeReceiptIssuer configured(String output,String mode)throws Exception{
        Path tool=directory.resolve("workproof-receipt"),key=directory.resolve("issuer.hex"),pub=directory.resolve("public.hex");
        Files.writeString(tool,"#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '"+output+"'\n");assertTrue(tool.toFile().setExecutable(true,true));
        Files.writeString(key,"11".repeat(32));Files.setPosixFilePermissions(key,PosixFilePermissions.fromString(mode));Files.writeString(pub,"22".repeat(32));
        return new NativeReceiptIssuer(tool.toString(),key.toString(),pub.toString(),"test-issuer",60,new ObjectMapper());
    }
    @Test void unconfiguredRemainsDisabled(){
        var service=new NativeReceiptIssuer("","","","",60,new ObjectMapper());
        try{assertEquals(false,service.capabilities().get("configured"));assertEquals(503,assertThrows(ServiceException.class,()->service.issue(new ByteArrayInputStream(new byte[0]))).code());}finally{service.close();}
    }
    @Test void insecurePrivateKeyPermissionsRemainDisabled()throws Exception{
        var service=configured("{}","rw-r--r--");try{assertEquals(false,service.capabilities().get("configured"));assertEquals(503,assertThrows(ServiceException.class,()->service.issue(new ByteArrayInputStream(new byte[0]))).code());}finally{service.close();}
    }
    @Test void unsupportedToolClaimsAreNotReturned()throws Exception{
        var service=configured("{\"payload\":{\"protocol\":\"workproof-server-receipt/1\",\"purpose\":\"official-client-generated\"},\"signature\":\"00\"}","rw-------");
        try{assertEquals(true,service.capabilities().get("configured"));assertEquals(503,assertThrows(ServiceException.class,()->service.issue(new ByteArrayInputStream("{}".getBytes()))).code());}finally{service.close();}
    }
}
