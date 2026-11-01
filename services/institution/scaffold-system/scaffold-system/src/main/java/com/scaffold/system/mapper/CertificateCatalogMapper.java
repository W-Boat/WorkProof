package com.scaffold.system.mapper;

import com.scaffold.framework.datascope.DataScopeCriteria;
import org.apache.ibatis.annotations.*;
import java.util.List;
import java.util.Map;

@Mapper
public interface CertificateCatalogMapper {
    long count(@Param("keyword") String keyword, @Param("recordScope") String recordScope, @Param("access") DataScopeCriteria access);
    List<Map<String,Object>> list(@Param("keyword") String keyword, @Param("recordScope") String recordScope, @Param("access") DataScopeCriteria access, @Param("offset") long offset, @Param("limit") int limit);
    Map<String,Object> detail(@Param("id") long id, @Param("access") DataScopeCriteria access);
    @Insert("""
        INSERT INTO wp_certificate (owner_user_id,dept_id,certificate_id,proof_hash,file_name,artifact_hash,record_scope,disclosed_events,total_events,demo,create_by,update_by)
        VALUES (#{ownerUserId},#{deptId},#{certificateId},#{proofHash},#{fileName},#{artifactHash},#{scope},#{disclosedEvents},#{totalEvents},#{demo},#{createBy},#{createBy})
        ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)
        """)
    @Options(useGeneratedKeys=true,keyProperty="id")
    int insert(Map<String,Object> row);
}
