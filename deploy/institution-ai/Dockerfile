# Optional CPU image only. Build from repository root; caller verifies the base
# reference resolves to BASE_IMAGE_ID before building, and validates layer ancestry.
ARG BASE_IMAGE
FROM ${BASE_IMAGE}
ARG BASE_IMAGE_ID
LABEL org.workproof.ai.base-image=${BASE_IMAGE_ID}
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv --copies /opt/workproof-ai/venv
COPY tools/ai-assessment/requirements.txt /opt/workproof-ai/requirements.txt
RUN /opt/workproof-ai/venv/bin/python -m pip install --no-cache-dir torch==2.15.0 --index-url https://download.pytorch.org/whl/cpu \
    && /opt/workproof-ai/venv/bin/python -m pip install --no-cache-dir -r /opt/workproof-ai/requirements.txt \
    && /opt/workproof-ai/venv/bin/python -m pip check
COPY tools/ai-assessment/detector.py tools/ai-assessment/documents.py tools/ai-assessment/desklib_backend.py tools/ai-assessment/engines.json /opt/workproof-ai/
COPY deploy/institution-ai/ai_runtime.py deploy/institution-ai/prepare_ai.py /opt/workproof-ai/
RUN /opt/workproof-ai/venv/bin/python /opt/workproof-ai/ai_runtime.py build --base-image ${BASE_IMAGE_ID} \
    && mkdir /opt/workproof-ai/models \
    && chown root:10001 /opt/workproof-ai/models && chmod 750 /opt/workproof-ai/models \
    && chmod 444 /opt/workproof-ai/*.py /opt/workproof-ai/*.json /opt/workproof-ai/requirements.txt
USER 10001:10001
