FROM eclipse-temurin:17-jre-noble
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pymysql python3-cryptography \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 workproof && useradd --uid 10001 --gid 10001 --no-create-home workproof \
    && mkdir -p /opt/workproof/sql /private/config /private/account /private/mysql-root /private/mysql-app /var/lib/workproof \
    && chown 10001:10001 /var/lib/workproof && chmod 700 /var/lib/workproof
COPY app.jar workproof-inspector entrypoint.py manage.py backup_crypto.py snapshot_archive.py /opt/workproof/
COPY sql/V1__init_schema.sql sql/V2__seed_data.sql /opt/workproof/sql/
RUN chmod 555 /opt/workproof/workproof-inspector && chmod 444 /opt/workproof/app.jar /opt/workproof/*.py /opt/workproof/sql/*.sql
WORKDIR /opt/workproof
USER 10001:10001
ENTRYPOINT ["python3", "/opt/workproof/entrypoint.py"]
