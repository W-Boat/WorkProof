package com.scaffold.system.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.scaffold.common.domain.PageQuery;
import com.scaffold.common.domain.PageResult;
import com.scaffold.common.exception.BusinessException;
import com.scaffold.common.exception.ServiceException;
import com.scaffold.common.util.CsvExport;
import com.scaffold.framework.datascope.DataScope;
import com.scaffold.framework.datascope.DataScopeContext;
import com.scaffold.system.mapper.CertificateCatalogMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import java.io.InputStream;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.util.*;

@Service
@DataScope
public class CertificateCatalogService {
    private final CertificateCatalogMapper mapper;
    private final NativeCertificateInspector inspector;
    private final AuthService auth;
    private final boolean enabled;
    public CertificateCatalogService(CertificateCatalogMapper mapper, NativeCertificateInspector inspector, AuthService auth,
            @Value("${workproof.catalog.enabled:false}") boolean enabled) {
        this.mapper=mapper;this.inspector=inspector;this.auth=auth;this.enabled=enabled;
    }
    private void requireReady() {
        var status=status();
        if (!status.ready()) throw new ServiceException(503,status.message());
    }
    public record Status(boolean enabled, boolean schemaPrepared, boolean ready, String message) {}
    public Status status() {
        if (!enabled) return new Status(false,false,false,"证书列表尚未启用，请联系管理员完成准备。单份证书检查仍可使用。");
        boolean prepared;
        try { prepared=mapper.schemaReady(); } catch (org.springframework.dao.DataAccessException error) { prepared=false; }
        return new Status(true,prepared,prepared,prepared?"证书列表已就绪，可以查询和保存摘要。":"证书列表的数据结构尚未准备好，请联系管理员核对并执行 V3 迁移。单份证书检查仍可使用。");
    }
    private String keyword(String value) {
        if (value==null || value.isBlank()) return null;
        if (value.length()>128) throw new BusinessException("搜索内容过长，请使用文件名的一部分或完整证书指纹。");
        return value.trim();
    }
    private String scope(String value) {
        if (value==null || value.isBlank()) return null;
        if (!Set.of("full","selective").contains(value)) throw new BusinessException("请选择全部记录或部分记录。");
        return value;
    }
    private Map<String,Object> boundaries(Map<String,Object> row) {
        if (row==null) throw new BusinessException("记录不存在，或你没有查看权限。");
        row.put("artifactChecked",false);row.put("identityVerified",false);row.put("timeVerified",false);
        return row;
    }
    public PageResult<Map<String,Object>> list(PageQuery page, String keyword, String scope) {
        requireReady();String term=keyword(keyword),range=scope(scope);
        var access=DataScopeContext.required();int number=page.normalizedPageNum(),size=page.normalizedPageSize();
        long count=mapper.count(term,range,access);
        var rows=mapper.list(term,range,access,(long)(number-1)*size,size).stream().map(this::boundaries).toList();
        return PageResult.of(rows,count,number,size);
    }
    public Map<String,Object> detail(long id) { requireReady();return boundaries(mapper.detail(id,DataScopeContext.required())); }
    public record Saved(Map<String,Object> entry, JsonNode inspection) {}
    public Saved save(InputStream input) throws Exception {
        requireReady();
        var digest=MessageDigest.getInstance("SHA-256");
        var report=inspector.inspect(new DigestInputStream(input,digest));
        if (!report.path("certificate_valid").asBoolean()) throw new BusinessException("证书内容未能确认，没有保存。请索取未修改的原始证书。");
        var user=auth.currentUser();var manifest=report.path("manifest");
        Map<String,Object> row=new HashMap<>();
        row.put("ownerUserId",user.userId());row.put("deptId",user.deptId());row.put("createBy",user.username());
        row.put("certificateId",report.path("certificateId").asText());row.put("proofHash",HexFormat.of().formatHex(digest.digest()));
        row.put("fileName",manifest.path("file_name").asText());row.put("artifactHash",manifest.path("artifact_hash").asText());
        row.put("scope",report.path("scope").asText());row.put("disclosedEvents",report.path("disclosed_events").longValue());
        row.put("totalEvents",report.path("total_events").longValue());row.put("demo",manifest.path("demo").asBoolean()?1:0);
        mapper.insert(row);
        return new Saved(boundaries(mapper.detail(((Number)row.get("id")).longValue(),DataScopeContext.required())),report);
    }
    public String export(String keyword, String scope) {
        requireReady();String term=keyword(keyword),range=scope(scope);var access=DataScopeContext.required();
        if (mapper.count(term,range,access)>5000) throw new BusinessException("结果超过 5000 条，请缩小搜索范围后导出。");
        var rows=mapper.list(term,range,access,0,5000).stream().map(row->Arrays.<Object>asList(
            row.get("fileName"),"selective".equals(row.get("scope"))?"部分记录":"全部记录",row.get("disclosedEvents"),row.get("totalEvents"),
            row.get("certificateId"),row.get("proofHash"),row.get("createBy"),row.get("checkedAt"),"未检查作品；未确认作者身份或实际创作时间")).toList();
        return CsvExport.encode(List.of("作品文件名","检查范围","本次操作数","操作总数","证书指纹","证书文件摘要","提交账号","服务器保存时间","检查边界"),rows);
    }
}
