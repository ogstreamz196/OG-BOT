import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops
src, out = sys.argv[1], sys.argv[2]
S=960
logo=Image.open(src).convert("RGB")
# background: blurred, dimmed logo filling the square
bg=logo.resize((int(S*logo.width/logo.height),S)).crop((0,0,S,S))
w=bg.width
bg=logo.resize((int(S*logo.width/logo.height),S))
bg=bg.crop(((bg.width-S)//2,0,(bg.width-S)//2+S,S)).filter(ImageFilter.GaussianBlur(18))
bg=Image.blend(bg, Image.new("RGB",(S,S),(4,7,20)), 0.55)
canvas=bg.copy()
# mascot head + claws (crop top part, without the OG BOT text)
L=logo.width; H=logo.height
crop=logo.crop((int(L*0.0),int(H*0.06),int(L*1.0),int(H*0.66)))
cw=int(S*1.12); ch=int(crop.height*cw/crop.width)
crop=crop.resize((cw,ch))
mask=Image.new("L",crop.size,0)
for y in range(ch):
    for_y=1.0 if y<ch*0.55 else max(0.0,1-(y-ch*0.55)/(ch*0.45))
    ImageDraw.Draw(mask).line((0,y,cw,y),fill=int(255*for_y))
side=Image.new("L",crop.size,0)
for x in range(cw):
    e=min(x,cw-1-x)/(cw*0.18); ImageDraw.Draw(side).line((x,0,x,ch),fill=int(255*min(1,e)))
mask=ImageChops.multiply(mask,side)
canvas.paste(crop,((S-cw)//2,10),mask)
# dark vignette bottom for text
grad=Image.new("L",(1,S))
for y in range(S): grad.putpixel((0,y), int(max(0,(y-S*0.45)/(S*0.55))*235))
grad=grad.resize((S,S))
canvas=Image.composite(Image.new("RGB",(S,S),(4,7,20)),canvas,grad)
d=ImageDraw.Draw(canvas)
# padlock with emerald glow
cx,cy=S//2,int(S*0.50)
glow=Image.new("RGBA",(S,S),(0,0,0,0)); gd=ImageDraw.Draw(glow)
gd.ellipse((cx-190,cy-170,cx+190,cy+210),fill=(16,185,129,150))
glow=glow.filter(ImageFilter.GaussianBlur(60))
canvas=Image.alpha_composite(canvas.convert("RGBA"),glow)
lock=Image.new("RGBA",(S,S),(0,0,0,0)); ld=ImageDraw.Draw(lock)
# shackle
ld.rounded_rectangle((cx-85,cy-150,cx+85,cy+40),radius=85,outline=(220,226,235,255),width=34)
# body with chrome gradient
body=(cx-135,cy-20,cx+135,cy+190)
bodyimg=Image.new("RGBA",(body[2]-body[0],body[3]-body[1]))
for y in range(bodyimg.height):
    t=y/bodyimg.height
    c=int(245-120*t) if t<0.5 else int(185-60*(t-0.5))
    for x in range(bodyimg.width): pass
    ImageDraw.Draw(bodyimg).line((0,y,bodyimg.width,y),fill=(c,c+4,c+12,255))
bm=Image.new("L",bodyimg.size,0); ImageDraw.Draw(bm).rounded_rectangle((0,0,bodyimg.width-1,bodyimg.height-1),radius=34,fill=255)
lock.paste(bodyimg,(body[0],body[1]),bm)
ld.rounded_rectangle(body,radius=34,outline=(40,48,70,255),width=6)
# keyhole
ld.ellipse((cx-28,cy+45,cx+28,cy+101),fill=(4,7,20,255))
ld.polygon([(cx-16,cy+90),(cx+16,cy+90),(cx+24,cy+150),(cx-24,cy+150)],fill=(4,7,20,255))
shadow=lock.split()[3].filter(ImageFilter.GaussianBlur(10))
sh=Image.new("RGBA",(S,S),(0,0,0,200)); sh.putalpha(shadow.point(lambda a:a*0.8))
canvas=Image.alpha_composite(canvas,sh.transform((S,S),Image.AFFINE,(1,0,-8,0,1,-12)))
canvas=Image.alpha_composite(canvas,lock)
d=ImageDraw.Draw(canvas)
def font(sz):
    for f in ["/usr/share/fonts/opentype/inter/InterDisplay-Black.otf","/usr/share/fonts/opentype/inter/InterDisplay-ExtraBold.otf","/usr/share/fonts/opentype/inter/InterDisplay-Bold.otf"]:
        try: return ImageFont.truetype(f,sz)
        except Exception: pass
    return ImageFont.load_default()
# title chrome text
title="OG KEYS"; f=font(170)
tw=d.textlength(title,font=f); tx=(S-tw)/2; ty=int(S*0.70)
tl=Image.new("L",(S,S),0); ImageDraw.Draw(tl).text((tx,ty),title,font=f,fill=255)
chrome=Image.new("RGBA",(S,S))
cd=ImageDraw.Draw(chrome)
for y in range(S):
    t=(y-ty)/220
    if t<0.45: c=int(250-90*max(0,t)/0.45)
    else: c=int(150+80*min(1,(t-0.45)/0.55))
    c=max(0,min(255,c)); cd.line((0,y,S,y),fill=(c,c+3,min(255,c+10),255))
outline=tl.filter(ImageFilter.MaxFilter(9))
ol=Image.new("RGBA",(S,S),(16,185,129,255)); ol.putalpha(outline)
olg=ol.filter(ImageFilter.GaussianBlur(8))
canvas=Image.alpha_composite(canvas,olg)
dk=Image.new("RGBA",(S,S),(10,14,28,255)); dk.putalpha(tl.filter(ImageFilter.MaxFilter(7)))
canvas=Image.alpha_composite(canvas,dk)
chrome.putalpha(tl); canvas=Image.alpha_composite(canvas,chrome)
d=ImageDraw.Draw(canvas)
# coming soon ribbon
sub="COMING SOON"; f2=font(54)
sw=d.textlength(sub,font=f2); pad=34
rx0=(S-sw)/2-pad; ry0=int(S*0.885); rx1=(S+sw)/2+pad; ry1=ry0+82
d.rounded_rectangle((rx0,ry0,rx1,ry1),radius=41,fill=(16,185,129,255))
d.text(((S-sw)/2,ry0+10),sub,font=f2,fill=(4,7,20,255))
canvas.convert("RGB").save(out+".png")
canvas.convert("RGB").save(out+".webp","WEBP",quality=82,method=6)
canvas.convert("RGB").resize((480,480),Image.LANCZOS).save(out+"-480.webp","WEBP",quality=80,method=6)
