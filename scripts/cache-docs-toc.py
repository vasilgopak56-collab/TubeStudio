"""Cache accurate TOC page numbers from a rendered PDF (requires pymupdf, lxml).
Usage: python scripts/cache-docs-toc.py documentation.docx documentation.pdf
Re-export the DOCX to PDF after this step. Word can still update its TOC.
"""
import re, sys, zipfile
from pathlib import Path
from lxml import etree
import pymupdf
path, pdfpath = map(Path, sys.argv[1:3])
ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
w='{'+ns['w']+'}'
with zipfile.ZipFile(path) as z:
 files={x.filename:z.read(x.filename) for x in z.infolist()}
root=etree.fromstring(files['word/document.xml'])
def norm(s): return re.sub(r'[^\w]+','',s.casefold())
pdf=pymupdf.open(pdfpath)
# Match whole heading blocks at their actual font sizes, not body substrings.
# Otherwise e.g. «Раскадровка» incorrectly matches «Раскадровка из озвучки».
pages=[]
for page in pdf:
 candidates=set()
 for block in page.get_text('dict')['blocks']:
  if 'lines' not in block: continue
  spans=[span for line in block['lines'] for span in line['spans']]
  for size in (14.5,18.0):
   selected=[span['text'] for span in spans if abs(span['size']-size)<0.15]
   if selected: candidates.add(norm(' '.join(selected)))
 pages.append(candidates)
lookup={}; current=3
for heading in root.xpath('//w:p[w:pPr/w:pStyle[@w:val="Heading1" or @w:val="Heading2"]]', namespaces=ns):
 text=''.join(heading.xpath('.//w:t/text()',namespaces=ns))
 hits=[i for i in range(current,len(pages)) if norm(text) in pages[i]]
 if not hits: raise RuntimeError('Heading not found in PDF: '+text)
 current=hits[0]
 for bookmark in heading.xpath('.//w:bookmarkStart',namespaces=ns): lookup[bookmark.get(w+'name')]=current+1
filled=0
for run in root.xpath('//w:sdt//w:r[w:instrText]', namespaces=ns):
 instr=''.join(run.xpath('./w:instrText/text()',namespaces=ns))
 match=re.search(r'PAGEREF\s+(\S+)',instr)
 if not match: continue
 if match.group(1) not in lookup: raise RuntimeError('Unknown heading '+match.group(1))
 end=run.find(w+'fldChar[@'+w+'fldCharType="end"]')
 # cached result belongs between the separator and closing field marker
 for node in list(run):
  if node.tag==w+'t': run.remove(node)
 text=etree.Element(w+'t');text.text=str(lookup[match.group(1)])
 run.insert(list(run).index(end),text)
 for node in run.findall(w+'fldChar'):
  if node.get(w+'fldCharType')=='begin': node.set(w+'dirty','false')
 filled+=1
settings=etree.fromstring(files['word/settings.xml'])
update=settings.find(w+'updateFields')
if update is not None: update.set(w+'val','false')
files['word/settings.xml']=etree.tostring(settings,xml_declaration=True,encoding='UTF-8',standalone=True)
files['word/document.xml']=etree.tostring(root,xml_declaration=True,encoding='UTF-8',standalone=True)
with zipfile.ZipFile(path,'w',zipfile.ZIP_DEFLATED) as z:
 for name,data in files.items(): z.writestr(name,data)
print('Cached page numbers:',filled)
