import unittest,json,hashlib
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]/'assets/materials'

class DailyStickerTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.manifest=json.loads((ROOT/'manifest.json').read_text(encoding='utf-8'));cls.items=[i for i in cls.manifest['items'] if i.get('pack')=='daily-stickers']
 def test_counts_and_legacy_assets(self):
  self.assertEqual(len(self.items),96);self.assertEqual(len(self.manifest['items']),877)
  self.assertEqual(sum(i['cat']=='sticker' for i in self.manifest['items']),369)
  self.assertEqual(sum(i['cat']=='stamp' for i in self.manifest['items']),103)
  collections=[c for c in self.manifest['collections'] if c['id'].startswith('daily_')];self.assertEqual(len(collections),8)
  for c in collections:self.assertEqual(c['count'],12);self.assertEqual(sum(i['collection']==c['id'] for i in self.items),12)
  self.assertTrue(any(i['id']=='sticker_motif_fox' for i in self.manifest['items']))
 def test_unique_cutouts_with_transparent_edges_and_real_thumbnails(self):
  hashes=set()
  for i in self.items:
   with Image.open(ROOT/i['file']) as im:
    self.assertEqual(im.mode,'RGBA');self.assertEqual(im.size,(640,640));a=im.getchannel('A');self.assertEqual(a.getextrema(),(0,255));bbox=a.getbbox();self.assertTrue(bbox and bbox[0]>10 and bbox[1]>10 and bbox[2]<630 and bbox[3]<630,i['id']);hashes.add(hashlib.sha256(im.tobytes()).hexdigest())
   with Image.open(ROOT/i['thumb']) as thumb:self.assertEqual(thumb.size,(180,180));self.assertEqual(thumb.mode,'RGBA')
  self.assertEqual(len(hashes),96)
 def test_license_and_search_metadata(self):
  for i in self.items:
   self.assertEqual(i['license'],'CC0-1.0');self.assertEqual(i['cat'],'sticker');self.assertIn('原创',i['author']);self.assertTrue(i['tags'] and i['name']);self.assertTrue(i['alpha'])

if __name__=='__main__':unittest.main()
