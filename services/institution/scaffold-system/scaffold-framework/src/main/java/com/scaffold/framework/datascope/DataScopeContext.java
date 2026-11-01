package com.scaffold.framework.datascope;

public final class DataScopeContext {

    private static final ThreadLocal<DataScopeCriteria> HOLDER = new ThreadLocal<>();

    private DataScopeContext() {
    }

    public static void set(DataScopeCriteria criteria) {
        HOLDER.set(criteria == null ? DataScopeCriteria.selfOnly(null) : criteria);
    }

    public static DataScopeCriteria current() {
        DataScopeCriteria criteria = HOLDER.get();
        return criteria == null ? DataScopeCriteria.all() : criteria;
    }

    public static void clear() {
        HOLDER.remove();
    }

    /** For sensitive new modules, an absent aspect context must never mean unrestricted access. */
    public static DataScopeCriteria required() {
        DataScopeCriteria criteria = HOLDER.get();
        return criteria == null ? DataScopeCriteria.selfOnly(null) : criteria;
    }
}
