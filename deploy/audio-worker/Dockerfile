# Alleen een offline, inactieve infrastructuurproef; geen generator of pakketimporter.
FROM python:3.13-alpine@sha256:8bcfa47b04b853a17aaf909362b847b2112fd6ec4105ea553ef9a43bafbb5916
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /opt/versado-worker
COPY --chmod=0444 deploy/audio-worker/worker.py ./worker.py
# De werkelijke contractbron, geen gekopieerde/afwijkende JSON-schema-implementatie.
COPY --chmod=0444 src/lib/audio/contract.ts ./reference/contract.ts
RUN chmod 0555 /opt/versado-worker /opt/versado-worker/reference
USER 10001:10001
ENTRYPOINT ["python", "-I", "/opt/versado-worker/worker.py"]
CMD ["status"]
