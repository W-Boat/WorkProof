package com.scaffold.common.exception;

/** 临时服务状态：容量已满、服务不可用或处理超时。 */
public class ServiceException extends RuntimeException {
    private final int code;
    public ServiceException(int code, String message) {
        super(message);
        if (code != 429 && code != 503 && code != 504) throw new IllegalArgumentException("Unsupported service status");
        this.code = code;
    }
    public int code() { return code; }
}
