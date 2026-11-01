"""Regenerate the English technical PDF from docs/TECHNICAL_REPORT.md.
Requires Python packages reportlab and Pillow. Run from the repository root.
"""
from pathlib import Path
import re
from html import escape
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, KeepTogether
from PIL import Image as PILImage

ROOT = Path(__file__).resolve().parents[1]
font_dir = Path('C:/Windows/Fonts')
if font_dir.exists():
    files = ['arial.ttf', 'arialbd.ttf', 'ariali.ttf', 'arialbi.ttf']
else:
    font_dir = Path('/usr/share/fonts/truetype/dejavu')
    files = ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf', 'DejaVuSans-Oblique.ttf', 'DejaVuSans-BoldOblique.ttf']
for name, file in zip(['Body', 'Body-Bold', 'Body-Italic', 'Body-BoldItalic'], files):
    pdfmetrics.registerFont(TTFont(name, str(font_dir/file)))
pdfmetrics.registerFontFamily('Body', normal='Body', bold='Body-Bold', italic='Body-Italic', boldItalic='Body-BoldItalic')
styles = getSampleStyleSheet()
styles.add(ParagraphStyle(name='Text', fontName='Body', fontSize=9.4, leading=13.1, textColor=colors.HexColor('#253146'), spaceAfter=7, alignment=TA_LEFT))
styles.add(ParagraphStyle(name='ReportTitle', parent=styles['Text'], fontName='Body-Bold', fontSize=20, leading=25, spaceAfter=12, textColor=colors.HexColor('#133e4a')))
styles.add(ParagraphStyle(name='Section', parent=styles['Text'], fontName='Body-Bold', fontSize=13, leading=17, spaceBefore=12, spaceAfter=7, keepWithNext=True))
styles.add(ParagraphStyle(name='Subsection', parent=styles['Section'], fontSize=10.6, leading=14, spaceBefore=8))
styles.add(ParagraphStyle(name='CaptionSmall', parent=styles['Text'], fontSize=8, leading=10.5, textColor=colors.HexColor('#526277')))
styles.add(ParagraphStyle(name='TableText', parent=styles['Text'], fontSize=8.1, leading=10.5, spaceAfter=0))
styles.add(ParagraphStyle(name='ReferencesText', parent=styles['Text'], fontSize=8.3, leading=11.5, spaceAfter=4))
styles.add(ParagraphStyle(name='TableCaption', parent=styles['CaptionSmall'], keepWithNext=True))

def markup(text):
    text = escape(text)
    # Sub/superscript Unicode glyphs are not reliable in all PDF fonts.
    sub = str.maketrans('₀₁₂₃₄₅₆₇₈₉ᵢ', '0123456789i')
    sup = str.maketrans('⁰¹²³⁴⁵⁶⁷⁸⁹', '0123456789')
    text = re.sub(r'[₀₁₂₃₄₅₆₇₈₉ᵢ]+', lambda m: '<sub>'+m[0].translate(sub)+'</sub>', text)
    text = re.sub(r'[⁰¹²³⁴⁵⁶⁷⁸⁹]+', lambda m: '<super>'+m[0].translate(sup)+'</super>', text)
    text = text.replace('∈', 'in').replace('ℓ', 'l')
    text = re.sub(r'_([a-z]+)', r'<sub>\1</sub>', text)
    text = re.sub(r'\[([^]]+)\]\([^)]+\)', r'\1', text)
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'\*(.+?)\*', r'<i>\1</i>', text)
    text = re.sub(r'`([^`]+)`', r'\1', text)
    return text

story=[]
lines=(ROOT/'docs/TECHNICAL_REPORT.md').read_text(encoding='utf8').splitlines()
i=0
references=False
width=A4[0]-86
while i<len(lines):
    line=lines[i].strip()
    if not line: i+=1; continue
    if line.startswith('#'):
        n=len(line)-len(line.lstrip('#'))
        references = line[n:].strip() == 'References'
        story.append(Paragraph(markup(line[n:].strip()),styles['ReportTitle' if n==1 else 'Section' if n==2 else 'Subsection']))
        i+=1; continue
    m=re.fullmatch(r'!\[(.*?)\]\((.*?)\)',line)
    if m:
        image_path=ROOT/'docs'/m[2]
        with PILImage.open(image_path) as img: w,h=img.size
        scale=min(width/w,170/h)
        story.append(KeepTogether([Spacer(1,4),Image(str(image_path),width=w*scale,height=h*scale),Spacer(1,4),Paragraph(markup(m[1]),styles['CaptionSmall'])]))
        i+=1; continue
    if line.startswith('|'):
        rows=[]
        while i<len(lines) and lines[i].strip().startswith('|'):
            cells=[c.strip() for c in lines[i].strip().strip('|').split('|')]
            if not all(re.fullmatch(r'[:\- ]+',c) for c in cells):
                rows.append([Paragraph(markup(c),styles['TableText']) for c in cells])
            i+=1
        cols=len(rows[0]); widths=([.18,.17,.27,.38] if cols==4 else [.42,.58] if cols==2 else [1/cols]*cols)
        table=Table(rows,colWidths=[w*width for w in widths],repeatRows=1,hAlign='LEFT')
        table.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#e4eef0')),('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6),('TOPPADDING',(0,0),(-1,-1),5),('BOTTOMPADDING',(0,0),(-1,-1),5),('LINEBELOW',(0,0),(-1,-1),.3,colors.HexColor('#cfdae0'))]))
        story.append(KeepTogether([table,Spacer(1,9)])); continue
    if re.match(r'^\d+\. ',line):
        story.append(Paragraph(markup(line),styles['Text']));i+=1;continue
    parts=[line];i+=1
    while i<len(lines) and lines[i].strip() and not lines[i].startswith(('#','|','![')):
        if references: break
        # Keep bibliography entries individually readable.
        if re.match(r'^[A-Z][\w\-]+,.*\(\d{4}\)',lines[i]): break
        parts.append(lines[i].strip());i+=1
    style = 'ReferencesText' if references else 'TableCaption' if line.startswith('**Table ') else 'Text'
    story.append(Paragraph(markup(' '.join(parts)),styles[style]))

def footer(canvas, doc):
    canvas.saveState();canvas.setFont('Body',7.5);canvas.setFillColor(colors.HexColor('#5c6c7e'))
    canvas.drawString(43,25,'CogniTwin | Zaineb Ben Fadhl, Rami Bouzid | CISTAC 1.0 AI4Brain | revised 1 November 2026')
    canvas.drawRightString(A4[0]-43,25,str(doc.page));canvas.restoreState()

out=ROOT/'deliverables/CogniTwin-technical-report.pdf'
SimpleDocTemplate(str(out),pagesize=A4,rightMargin=43,leftMargin=43,topMargin=36,bottomMargin=40,title='CogniTwin - technical report',author='Zaineb Ben Fadhl, Rami Bouzid').build(story,onFirstPage=footer,onLaterPages=footer)
print(out)
