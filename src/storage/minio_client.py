# src/storage/minio_client.py
"""
MinIO object storage client for Bronze layer Parquet persistence.

All methods are synchronous — called from async contexts via
asyncio.to_thread() in Prefect tasks. MinIO SDK is synchronous by design.

Partition scheme: {psp}/{event_date=YYYY-MM-DD}/hour={HH}/{run_id}-part-{NNNN}.parquet
This supports time-partitioned queries, efficient DuckDB scans, and
predictable retention policy application.

References:
    - TDD §7.2: MinIO Client — Parquet Write/Read
    - Data Architecture §4.1: Bronze Layer Storage
"""
import io
from datetime import datetime

import pyarrow as pa
import pyarrow.parquet as pq
import structlog
from minio import Minio
from minio.error import S3Error

from src.config import get_settings

log = structlog.get_logger(__name__)


class MinIOClient:
    """
    Thin wrapper around the MinIO SDK.
    All methods are synchronous — called from async contexts
    via asyncio.to_thread() in Prefect tasks.
    """

    def __init__(self) -> None:
        settings = get_settings()
        self._client = Minio(
            endpoint=settings.minio_endpoint,
            access_key=settings.minio_access_key,
            secret_key=settings.minio_secret_key,
            secure=settings.minio_use_ssl,
        )
        self._bronze_bucket = settings.minio_bronze_bucket

    def ensure_bucket(self) -> None:
        """Create the Bronze bucket if it doesn't exist."""
        if not self._client.bucket_exists(self._bronze_bucket):
            self._client.make_bucket(self._bronze_bucket)
            log.info("minio.bucket_created", bucket=self._bronze_bucket)

    def write_parquet(
        self,
        table: pa.Table,
        psp_name: str,
        event_date: datetime,
        run_id: str,
        part_number: int = 1,
    ) -> str:
        """
        Write a PyArrow Table as a Parquet file to MinIO.

        Partition path: {psp}/{event_date=YYYY-MM-DD}/hour={HH}/
        Returns the full MinIO object path (s3://bucket/key).
        """
        date_str = event_date.strftime("%Y-%m-%d")
        hour_str = event_date.strftime("%H")
        object_path = (
            f"{psp_name}/"
            f"event_date={date_str}/"
            f"hour={hour_str}/"
            f"{run_id}-part-{part_number:04d}.parquet"
        )

        buffer = io.BytesIO()
        pq.write_table(
            table,
            buffer,
            compression="snappy",
            write_statistics=True,
        )
        buffer.seek(0)
        file_size = buffer.getbuffer().nbytes

        try:
            self._client.put_object(
                bucket_name=self._bronze_bucket,
                object_name=object_path,
                data=buffer,
                length=file_size,
                content_type="application/octet-stream",
            )
        except S3Error as e:
            log.error(
                "minio.write_failed",
                object_path=object_path,
                error=str(e),
            )
            raise

        full_path = f"s3://{self._bronze_bucket}/{object_path}"
        log.info(
            "minio.parquet_written",
            path=full_path,
            rows=table.num_rows,
            size_bytes=file_size,
        )
        return full_path

    def read_parquet(self, object_path: str) -> pa.Table:
        """
        Read a Parquet file from MinIO into a PyArrow Table.
        Strips the s3:// prefix if present.
        """
        clean_path = object_path.replace(
            f"s3://{self._bronze_bucket}/", ""
        )
        response = None
        try:
            response = self._client.get_object(self._bronze_bucket, clean_path)
            buffer = io.BytesIO(response.read())
            return pq.read_table(buffer)
        except S3Error as e:
            log.error("minio.read_failed", path=object_path, error=str(e))
            raise
        finally:
            if response is not None:
                response.close()
                response.release_conn()

    def list_objects(
        self,
        prefix: str,
        recursive: bool = True,
    ) -> list[str]:
        """List object keys matching a prefix in the Bronze bucket."""
        objects = self._client.list_objects(
            self._bronze_bucket,
            prefix=prefix,
            recursive=recursive,
        )
        return [obj.object_name for obj in objects]
