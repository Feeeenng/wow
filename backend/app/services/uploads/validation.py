"""S3 分片布局与校验和的纯计算，不相信客户端 ETag。"""

import base64
import hashlib
import math

from app.core.errors import DomainError


def total_parts(size: int, part_size: int, maximum: int) -> int:
    """限制单个 Multipart 的合法页数。"""
    count = math.ceil(size / part_size)
    if not 1 <= count <= maximum:
        raise DomainError(422, "录像大小超出分片布局限制")
    return count


def part_size(size: int, chunk_size: int, count: int, number: int) -> int:
    """每片大小由登记文件确定，客户端不得用小片填满任务。"""
    if not 1 <= number <= count:
        raise DomainError(422, "分片编号超出录像范围")
    return min(chunk_size, size - (number - 1) * chunk_size)


def checksum_base64(checksum: str) -> str:
    """将约定的小写十六进制 SHA-256 转为 S3 签名头格式。"""
    return base64.b64encode(bytes.fromhex(checksum)).decode("ascii")


def composite_checksum(checksums: list[str]) -> str:
    """Multipart 复合校验和不等于原始文件 SHA-256，也不等于 ETag。"""
    digest = hashlib.sha256(b"".join(bytes.fromhex(value) for value in checksums)).digest()
    return f"{base64.b64encode(digest).decode('ascii')}-{len(checksums)}"


def verify_part(observed: dict, expected_size: int, expected_checksum: str) -> None:
    """只接受 S3 返回的实际大小、SHA-256 和非空 ETag。"""
    if observed.get("Size") != expected_size or observed.get("ChecksumSHA256") != checksum_base64(expected_checksum) or not observed.get("ETag"):
        raise DomainError(409, "对象存储中的分片大小或 SHA-256 与签发内容不一致")
