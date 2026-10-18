"""验证本地图标凭据的错误路径，防止错误身份或被改写图片混入资料包。"""

import copy
import importlib.util
import json
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location("spell_resources", ROOT / "build-spell-resources.py")
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)


class LocalIconEvidenceTests(unittest.TestCase):
    """使用实际提取PNG验证身份、摘要及边界，不依赖网络或正式应用状态。"""

    def setUp(self):
        """仅复制一张已提取图片及其来源凭据到隔离目录。"""
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.output = pathlib.Path(self.directory.name)
        (self.output / "icons").mkdir()
        bundled = ROOT.parent / "src-tauri/resources/game-data"
        self.receipt = json.loads((bundled / "local-icons.json").read_text(encoding="utf-8"))
        self.receipt["files"] = self.receipt["files"][:1]
        row = self.receipt["files"][0]
        (self.output / "icons" / row["icon"]).write_bytes((bundled / "icons" / row["icon"]).read_bytes())
        self.wanted = {row["fileDataId"]}

    def read(self, receipt=None):
        """调用真实构建入口读取隔离凭据。"""
        path = self.output / "local-icons.json"
        path.write_text(json.dumps(receipt or self.receipt), encoding="utf-8")
        return BUILDER.local_icons(path, self.output, self.wanted)

    def test_real_png_accepted_and_missing_input_is_optional(self):
        """真实图片可读，无本地图标输入仍保留原构建模式。"""
        self.assertEqual(set(self.read()[0]), self.wanted)
        self.assertEqual(BUILDER.local_icons(None, self.output, self.wanted), ({}, None))

    def test_modified_pixels_are_rejected(self):
        """长度与图片头不变也不能绕过完整摘要检查。"""
        path = self.output / "icons" / self.receipt["files"][0]["icon"]
        data = bytearray(path.read_bytes())
        data[-20] ^= 1
        path.write_bytes(data)
        with self.assertRaises(ValueError):
            self.read()

    def test_duplicate_unknown_id_and_path_escape_are_rejected(self):
        """固定DB2之外的身份、重复身份及路径输入均不能入包。"""
        for change in [lambda row: row.update(fileDataId=1), lambda row: row.update(icon="../outside.png")]:
            receipt = copy.deepcopy(self.receipt)
            change(receipt["files"][0])
            with self.assertRaises(ValueError):
                self.read(receipt)
        receipt = copy.deepcopy(self.receipt)
        receipt["files"] *= 2
        with self.assertRaises(ValueError):
            self.read(receipt)

    def test_wrong_dimensions_and_content_hash_are_rejected(self):
        """凭据尺寸与原始内容身份不可被静默替换。"""
        for field, value in [("dimensions", [128, 128]), ("contentMd5", "unknown")]:
            receipt = copy.deepcopy(self.receipt)
            receipt["files"][0][field] = value
            with self.assertRaises(ValueError):
                self.read(receipt)


if __name__ == "__main__":
    unittest.main()
