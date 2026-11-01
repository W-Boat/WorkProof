package com.scaffold.framework.audit;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Target({ElementType.METHOD, ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
public @interface OperLog {

    String module();

    String action();

    /** 是否记录请求内容；证书等用户文件内容应关闭。 */
    boolean recordParams() default true;
}
