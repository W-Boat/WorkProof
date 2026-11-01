package com.scaffold.system.mapper;

import com.scaffold.framework.datascope.DataScopeCriteria;
import org.apache.ibatis.annotations.*;
import java.util.List;
import java.util.Map;

@Mapper
public interface CertificateCatalogMapper {
    @Select("""
      SELECT
      (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='wp_certificate' AND (
        (column_name IN ('id','owner_user_id','dept_id','disclosed_events','total_events') AND data_type='bigint') OR
        (column_name IN ('certificate_id','proof_hash','artifact_hash') AND data_type='char' AND character_maximum_length=64 AND collation_name='ascii_bin') OR
        (column_name='file_name' AND data_type='varchar' AND character_maximum_length>=1024) OR
        (column_name='record_scope' AND data_type='varchar' AND character_maximum_length>=16) OR
        (column_name IN ('create_by','update_by') AND data_type='varchar' AND character_maximum_length>=64) OR
        (column_name='demo' AND data_type='tinyint') OR
        (column_name IN ('create_time','update_time') AND data_type='datetime')
      ))=15 AND
      (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='wp_certificate' AND index_name='uk_wp_certificate_owner_proof' AND non_unique=0 AND sub_part IS NULL AND
        ((seq_in_index=1 AND column_name='owner_user_id') OR (seq_in_index=2 AND column_name='proof_hash')))=2 AND
      (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='wp_certificate' AND index_name='uk_wp_certificate_owner_proof')=2 AND
      (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='wp_certificate' AND column_name='id' AND extra LIKE '%auto_increment%')=1
      """)
    boolean schemaReady();
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
