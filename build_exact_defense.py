import asyncio, cv2, os, re, difflib, openpyxl
from collections import Counter
import winsdk.windows.graphics.imaging as imaging
import winsdk.windows.media.ocr as ocr
import winsdk.windows.storage as storage

async def build_exact_defense():
    engine = ocr.OcrEngine.try_create_from_user_profile_languages()
    base = r"D:\Robert\Desktop\App Project Builds\Gridiron_OC\Gridiron_OC\imports\Madden 27 Team Playbooks (Screenshots)\Chicago\Defense"
    
    # 1. Load M26 Defense canon
    m26_dir = r"D:\Robert\Desktop\App Project Builds\Gridiron_OC\Gridiron_OC\imports\Madden 26 Team Playbook (Excel Workbooks)"
    m26_canon = {}
    for f in os.listdir(m26_dir):
        if f.endswith(".xlsx"):
            try:
                wb = openpyxl.load_workbook(os.path.join(m26_dir, f), read_only=True)
                if "Defensive Plays" in wb.sheetnames:
                    ws = wb["Defensive Plays"]
                    for r in ws.iter_rows(values_only=True):
                        if r and len(r) >= 5 and r[3] and r[3] != "Play Name" and r[4]:
                            clean = re.sub(r"[^A-Z0-9]", "", str(r[3]).upper())
                            m26_canon[clean] = (str(r[3]).strip(), str(r[4]).strip())
            except: pass

    # Comprehensive repairs dictionary
    def_repairs = {
        # 4-3
        "SAMISTING": ("Sam 1 Sting", "BLITZ"),
        "SSBUTZI": ("SS Blitz 1", "BLITZ"),
        "SAWOBUST": ("Sam 0 Blast", "BLITZ"),
        "HAMMEROBLAST": ("Hammer 0 Blast", "BLITZ"),
        "COVER8SKYWK": ("Cover 3 Sky Wk", "ZONE"),
        "COVER21WERT": ("Cover 2 Invert", "ZONE"),
        "21WERTHARDFLAT": ("2 Invert Hard Flat", "ZONE"),
        "21NVERTHARDFLAT": ("2 Invert Hard Flat", "ZONE"),
        "COVER8HARDFLAT": ("Cover 3 Hard Flat", "ZONE"),
        "COVER81URDFLAT": ("Cover 3 Hard Flat", "ZONE"),
        "COVER8MATCH": ("Cover 3 Match", "MATCH"),
        "COVER8SKY": ("Cover 3 Sky", "ZONE"),
        "COVER4WARTERS": ("Cover 4 Quarters", "MATCH"),
        "COVER4PRESS": ("Cover 4 Press", "MATCH"),
        "COVERIHOLE": ("Cover 1 Hole", "MAN"),
        "IROBBERPRESS": ("1 Robber Press", "MAN"),
        "IHOLEPRESS": ("1 Hole Press", "MAN"),
        "ICOUTAINPRESS": ("1 Contain Press", "MAN"),
        "COVERICONUIN": ("Cover 1 Contain", "MAN"),
        "COVER2MAN": ("Cover 2 Man", "MAN"),
        "COVER2HARDFLAT": ("Cover 2 Hard Flat", "ZONE"),
        "LBSTINGI": ("LB Sting 1", "BLITZ"),
        "OLBFIREMAN": ("OLB Fire Man", "BLITZ"),
        "SAMEDGE8": ("Sam Edge 3", "BLITZ"),
        "THUNDERSMOKE": ("Thunder Smoke", "BLITZ"),
        "DBLSAFETYBLITZ": ("Dbl Safety Blitz", "BLITZ"),
        "FREEFIRE": ("Free Fire", "BLITZ"),
        "FREEFIREO": ("Free Fire 0", "BLITZ"),
        "FSFLRE8": ("FS Fire 3", "BLITZ"),
        "FSFIREI": ("FS Fire 1", "BLITZ"),
        "SAMCUSH8": ("Sam Crash 3", "BLITZ"),
        "SAMCRASHI": ("Sam Crash 1", "BLITZ"),
        "WILLGOFLRE8": ("Will Go Fire 3", "BLITZ"),
        "PINCHBIMO": ("Pinch Buck 0", "BLITZ"),
        "PINCHDOG2PRESS": ("Pinch Dog 2 Press", "BLITZ"),
        "STORMBUVEI": ("Storm Brave 1", "BLITZ"),
        "WILLBUCK3PRESS": ("Will Buck 3 Press", "BLITZ"),
        "CROSS3FIRE": ("Cross 3 Fire", "BLITZ"),
        "SS2TRAP": ("SS 2 Trap", "BLITZ"),
        "SAWBUTZI": ("Saw Blitz 3", "BLITZ"),
        "COVERS": ("Cover 6", "MATCH"),
        "COVERG": ("Cover 6", "MATCH"),
        "TAMPA2": ("Tampa 2", "ZONE"),
        "TAUPA2": ("Tampa 2", "ZONE"),
        "COVER8CWJDSTR": ("Cover 3 Cloud Str", "ZONE"),

        # 46
        "COVER8": ("Cover 3", "ZONE"),
        "COVERI": ("Cover 1", "BLITZ"),
        "EUGAGEEIGHT": ("Engage Eight", "BLITZ"),
        "GAPPRSS": ("Gap Press", "BLITZ"),
        "LBDOGS8": ("LB Dogs 3", "BLITZ"),
        "LBDOGS": ("LB Dogs", "BLITZ"),

        # Dollar
        "ZEROBUTZ": ("Zero Blitz", "BLITZ"),
        "COVER2DROP": ("Cover 2 Drop", "ZONE"),
        "DBFIRE2": ("DB Fire 2", "BLITZ"),
        "DBFLRE2": ("DB Fire 2", "BLITZ"),
        "OVERLOAD8SEAM": ("Overload 3 Seam", "BLITZ"),
        "OVERLOAD8SUM": ("Overload 3 Seam", "BLITZ"),
        "OVERLOADBLITZ": ("Overload Blitz", "BLITZ"),
        "COVER4DROP": ("Cover 4 Drop", "ZONE"),
        "DTMIKELOOP0": ("DT Mike Loop 0", "BLITZ"),
        "DTMIKELOOPO": ("DT Mike Loop 0", "BLITZ"),
        "DTMIKELOOP1": ("DT Mike Loop 1", "BLITZ"),
        "DTMIKELOOPI": ("DT Mike Loop 1", "BLITZ"),
        "ERIROBBERPRESS": ("Cover 1 Robber Press", "MAN"),
        "COVERIOBERPRESS": ("Cover 1 Robber Press", "MAN"),

        # Goal Line
        "GOPINCH": ("60 Pinch", "BLITZ"),
        "60PINCH": ("60 Pinch", "BLITZ"),
        "GOBASE": ("60 Base", "BLITZ"),
        "60BASE": ("60 Base", "BLITZ"),
        "GOHALFOUT": ("60 Half Out", "BLITZ"),
        "60HALFOUT": ("60 Half Out", "BLITZ"),
        "GOOUT": ("60 Out", "BLITZ"),
        "60OUT": ("60 Out", "BLITZ"),
        "GOOUTJACKS": ("60 Out Jacks", "BLITZ"),
        "60OUTJACKS": ("60 Out Jacks", "BLITZ"),
        "GUTS": ("Guts", "BLITZ"),
        "GLMAN": ("GL Man", "BLITZ"),
        "MLBGAPA": ("MLB Gap A", "BLITZ"),
        "GAPSAU": ("Gaps All", "BLITZ"),
        "GAPSALL": ("Gaps All", "BLITZ"),
        "GAPSAB": ("Gaps A B", "BLITZ"),
        "GAPSB": ("Gaps B", "BLITZ"),
        "GAPSAULB": ("Gaps All LB", "BLITZ"),
        "GAPSALLLB": ("Gaps All LB", "BLITZ"),
        "GOALLINEPINCH": ("60 Pinch", "BLITZ"),

        # Prevent
        "MAN8DEEP": ("Man 3 Deep", "MAN"),
        "MAN3DEEP": ("Man 3 Deep", "MAN"),
        "PREVENT": ("Prevent", "ZONE"),
        "COVER2DO": ("Cover 2 Drop", "ZONE"),
        "8DEEPBUTZ": ("3 Deep Blitz", "BLITZ"),
        "8DEEPBLITZ": ("3 Deep Blitz", "BLITZ"),
        "08DEEPBUTZ": ("3 Deep Blitz", "BLITZ"),
        "08DEEPBLITZ": ("3 Deep Blitz", "BLITZ"),
        "IDOUBLEBUZZ": ("3 Double Buzz", "ZONE"),

        # 3-3-5
        "PINCHBUTZO": ("Pinch Blitz 0", "BLITZ"),
        "PINCHBLITZO": ("Pinch Blitz 0", "BLITZ"),
        "COVER4URTERS": ("Cover 4 Quarters", "MATCH"),
        "COVEUURTERS": ("Cover 4 Quarters", "MATCH"),
        "SAWBUTZ3": ("Sam Blitz 3", "BLITZ"),
        "SAWBUTZ8": ("Sam Blitz 3", "BLITZ"),
        "COVERHOLEI": ("Cover Hole 1", "MAN"),
        "COVER4PILUS": ("Cover 4 Palms", "MATCH"),
        "COVER4US": ("Cover 4 Palms", "MATCH"),
        "HOTBLLTZ8": ("Hot Blitz 3", "BLITZ"),
        "COVERIOBER": ("Cover 1 Robber", "MAN"),
        "CORNERBUTZ3": ("Corner Blitz 3", "BLITZ"),
        "DMJBLEBUCKET": ("Double Bracket", "MAN"),
        "DUIEBUCKET": ("Double Bracket", "MAN"),
        "SLOTBUTZ3": ("Slot Blitz 3", "BLITZ"),
        "SLOTBUTZ8": ("Slot Blitz 3", "BLITZ"),
        "COVERGWILLIE": ("Cover 6 Willie", "MATCH"),
        "COVER8BLRZ": ("Cover 3 Buzz", "ZONE"),
        "COVER8BTM": ("Cover 3 Buzz", "ZONE"),
        "SAMMIKE8PRESS": ("Sam Mike 3 Press", "BLITZ"),
        "MIKEBLITZI": ("Mike Blitz 1", "BLITZ"),
        "MIKEBLITZJ": ("Mike Blitz 1", "BLITZ"),
        "CORUERBLITZ2": ("Corner Blitz 2", "BLITZ"),
        "CORNERBLITZ2": ("Corner Blitz 2", "BLITZ"),

        # Dime
        "EDGEBUTZO": ("Edge Blitz 0", "BLITZ"),
        "EDGEBLITZ0": ("Edge Blitz 0", "BLITZ"),
        "COVER8BLUMATCH": ("Cover 3 Buzz Match", "MATCH"),
        "COVER8BLRZMATCH": ("Cover 3 Buzz Match", "MATCH"),
        "IDOUBLEWRI": ("1 Double WR1", "MAN"),
        "FIELDSIM8": ("Field Sim 3", "BLITZ"),
        "FIELDSM8": ("Field Sim 3", "BLITZ"),
        "DMJBLEBUCKETSWITCH": ("Double Bracket Switch", "MAN"),
        "COVERIPALMS": ("Cover 4 Palms", "MATCH"),
        "COVERDPALMS": ("Cover 4 Palms", "MATCH"),
        "OVERSTORMBRAVE": ("Over Storm Brave", "BLITZ"),
        "COVERIROBBER": ("Cover 1 Robber", "MAN"),
        "EDGEBLITZ8": ("Edge Blitz 3", "BLITZ"),
        "EDGEBLITZ3": ("Edge Blitz 3", "BLITZ"),
        "COVER6SHW2": ("Cover 6 Show 2", "MATCH"),
        "COVER6SHW12": ("Cover 6 Show 2", "MATCH"),
        "OVERLOAD8PRESS": ("Overload 3 Press", "BLITZ"),
        "COVER8SHOW2": ("Cover 9 Show 2", "MATCH"),
        "COVER9SHOW2": ("Cover 9 Show 2", "MATCH"),
        "NICKEL2TRAP": ("Nickel 2 Trap", "BLITZ"),
        "NICKEL2TUP": ("Nickel 2 Trap", "BLITZ"),
        "NICKEL2TRP": ("Nickel 2 Trap", "BLITZ"),
        "NICKELSLM2": ("Nickel Sim 2", "BLITZ"),
        "NICKELS1M2": ("Nickel Sim 2", "BLITZ"),
        "COVERIHDLE": ("Cover 1 Hole", "MAN"),
        "SIMPRESSURE8": ("Sim Pressure 3", "BLITZ"),
        "FSWILLBLITZO": ("FS Will Blitz 0", "BLITZ"),
        "BUCKET9SWLTCH": ("Bracket 9 Switch", "MAN"),
        "BRACKET9SWLTCH": ("Bracket 9 Switch", "MAN"),
        "COVER2MATCH": ("Cover 2 Match", "MATCH"),
        "COVER8SAMMLE": ("Cover 3 Seam", "MATCH"),
        "COVERSAMMIE": ("Cover 3 Seam", "MATCH"),
        "BUCKETSWITCHWILLIE": ("Bracket Switch Willie", "MAN"),
        "BUCKETSWITCHWILUE": ("Bracket Switch Willie", "MAN"),
        "IDOUBLESLOT": ("1 Double Slot", "MAN"),
        "IDOUBLESLDT": ("1 Double Slot", "MAN"),
        "1DOUBLETE": ("1 Double TE", "MAN"),
        "IDOUBLETE": ("1 Double TE", "MAN"),
        "IDOUBLEWR2": ("1 Double WR2", "MAN"),
        "JDOUBLEWR2": ("1 Double WR2", "MAN"),
        "ROUCOVER21NVERT": ("Roll Cover 2 Invert", "ZONE"),
        "ROLLCOVER21NVERT": ("Roll Cover 2 Invert", "ZONE"),
        "ROLL28CLWD": ("Roll 2 Cloud", "ZONE"),
        "MLL28CWJD": ("Roll 2 Cloud", "ZONE"),
        "NL28CLOUD": ("Roll 2 Cloud", "ZONE"),
        "NL28CLOLJD": ("Roll 2 Cloud", "ZONE"),
        "MLLCOVER8CLOLD": ("Roll Cover 3 Cloud", "ZONE"),
        "ROLLCOVER8C": ("Roll Cover 3 Cloud", "ZONE"),
        "ROLLCOVER8CLOLD": ("Roll Cover 3 Cloud", "ZONE"),
        "COVER8CLOUD": ("Cover 3 Cloud", "ZONE"),
        "COVER8CIDJD": ("Cover 3 Cloud", "ZONE"),
        "COVER8CIMJD": ("Cover 3 Cloud", "ZONE"),
        "COVER8CLMJD": ("Cover 3 Cloud", "ZONE"),
        "MISIMPRESSURE": ("Mug Sim Pressure", "BLITZ"),
        "MUGDTLOOPI": ("Mug DT Loop 1", "BLITZ"),
        "MLSSBLLTZTEX8": ("Mug Blitz Tex 3", "BLITZ"),
        "MTMLLTZTEX8": ("Mug Blitz Tex 3", "BLITZ"),
        "BLITZDB": ("DB Blitz", "BLITZ"),
        "DIMEBLITZ2": ("Dime Blitz 2", "BLITZ"),
        "FSMLDDLEBLLTZ8": ("FS Middle Blitz 3", "BLITZ"),
        "COVER8BUMATCH": ("Cover 3 Buzz Match", "MATCH"),
        "COVER2ROU": ("Cover 2 Roll", "ZONE"),
        "SSSIMPRESSURE8": ("SS Sim Pressure 3", "BLITZ"),
        "FOXFIREZONEPRESS": ("Fox Fire Zone Press", "BLITZ"),
        "COVERICONTAINSPY": ("Cover 1 Contain Spy", "MAN"),
        "SSOVERLOAD8": ("SS Overload 3", "BLITZ"),

        # Nickel
        "CWER4PALUS": ("Cover 4 Palms", "MATCH"),
        "COVER4MLUS": ("Cover 4 Palms", "MATCH"),
        "FSWIUBUTZO": ("FS Will Blitz 0", "BLITZ"),
        "8BUZZMATCHWK": ("Cov 3 Buzz Match Wk", "MATCH"),
        "COV8BUZZMATCHWK": ("Cov 3 Buzz Match Wk", "MATCH"),
        "MBBERPRSS": ("1 Robber Press", "MAN"),
        "NICKELBUTZ8": ("Nickel Blitz 3", "BLITZ"),
        "NICKELBLLTZ8": ("Nickel Blitz 3", "BLITZ"),
        "LBBUTZI": ("LB Blitz 1", "BLITZ"),
        "SHWJSSSLM2": ("Show SS Sim 2", "BLITZ"),
        "SHMNSSSLM2": ("Show SS Sim 2", "BLITZ"),
        "2INVERTLURK": ("Cover 2 Invert Lurk", "ZONE"),
        "21MVERTLURK": ("Cover 2 Invert Lurk", "ZONE"),
        "MIDBLITZO": ("Mid Blitz 0", "BLITZ"),
        "BLITZLOOP3": ("Blitz Loop 3", "BLITZ"),
        "BLITZLOOP8": ("Blitz Loop 3", "BLITZ"),
        "COVER8SEAU": ("Cover 3 Seam", "MATCH"),
        "ER8SEAU": ("Cover 3 Seam", "MATCH"),
        "NICKELOVERLOAD3": ("Nickel Overload 3", "BLITZ"),
        "NICKELDVERLOD3": ("Nickel Overload 3", "BLITZ"),
        "LBBUTZ8": ("LB Blitz 3", "BLITZ"),
        "SSBLLTZ8": ("SS Blitz 3", "BLITZ"),
        "NICKELDOG8BUZZ": ("Nickel Dog 3 Buzz", "BLITZ"),
        "NICKELBLITZO": ("Nickel Blitz 0", "BLITZ"),
        "HOTBLITZ8": ("Hot Blitz 3", "BLITZ"),
        "LBBUTZO": ("LB Blitz 0", "BLITZ"),
        "LBDETWIST8": ("LB DE Twist 3", "BLITZ"),
        "COVER8WLLLLE": ("Cover 6 Willie", "MATCH"),
        "NICKELBLITZI": ("Nickel Blitz 1", "BLITZ"),
        "COVERILBBUTZ": ("Cover 1 LB Blitz", "BLITZ"),
        "NICKELBUTZ2": ("Nickel Blitz 2", "BLITZ"),
        "BLITZLOOPO": ("Blitz Loop 0", "BLITZ"),
        "BUTZLOOPO": ("Blitz Loop 0", "BLITZ"),
        "BLITZLOOPSM8": ("Blitz Loop Sim 3", "BLITZ"),
        "BLITZLOOPSLM8": ("Blitz Loop Sim 3", "BLITZ"),
        "MIDBLITZ": ("Mid Blitz", "BLITZ"),
        "COVERIGAMS": ("Cover 1 Games", "BLITZ"),
        "IDTLBLODP": ("1 DT LB Loop", "BLITZ"),
        "HOTBLITZ3": ("Hot Blitz 3", "BLITZ"),
        "LBPOPO": ("LB Pop 0", "BLITZ"),
        "CBBENCHSLM2": ("CB Bench Sim 2", "ZONE"),
        "REDZONEDTDO": ("Redzone DT Drop", "BLITZ"),
        "SSDOG8": ("SS Dog 3", "BLITZ"),
        "SSSIM2": ("Cross Sim 2", "BLITZ"),
        "8SUMSHOW2": ("8 Sim Show 2", "BLITZ"),
        "PINCHO": ("Pinch 0", "BLITZ"),
        "COVER4D0": ("Cover 4 Drop", "ZONE"),
        "LBCROSS8SHW12": ("LB Cross 3 Show 2", "BLITZ"),
        "LBCROSS8SHW2": ("LB Cross 3 Show 2", "BLITZ"),
        "PINCH2": ("Pinch 2", "BLITZ"),
        "SAMMIKELOOP8": ("Sam Mike Loop 3", "BLITZ"),
        "BENCHBLITZ8": ("Bench Blitz 3", "BLITZ"),
        "BENCHBUTZ8": ("Bench Blitz 3", "BLITZ"),
        "SAMMIKELOOPI": ("Sam Mike Loop 1", "BLITZ"),
        "CWER8SKYPRESS": ("Cover 3 Sky Press", "ZONE"),
        "TAUPA2CDUTALN": ("Tampa 2 Contain", "ZONE"),
        "TAUPA2CDNTALN": ("Tampa 2 Contain", "ZONE"),
        "SILVERSHDOTPINCH": ("Silver Shoot Pinch", "BLITZ"),
        "ILBBUTZ": ("1 LB Blitz", "BLITZ"),
        "COV21NVERTHARDFLAT": ("Cover 2 Invert Hard Flat", "ZONE"),
        "CBZONEBUTZ": ("CB Zone Blitz", "BLITZ"),
        "COVERBZONE": ("Cover 6 Zone", "ZONE"),
        "COVERGZONE": ("Cover 6 Zone", "ZONE"),
        "COVER9ZONE": ("Cover 9 Zone", "ZONE"),
        "COVER4ZONE": ("Cover 4 Zone", "ZONE"),
    }
    
    rows = []
    
    for form in sorted(os.listdir(base)):
        fpath = os.path.join(base, form)
        if not os.path.isdir(fpath): continue
        files = sorted([f for f in os.listdir(fpath) if f.endswith(".png")])
        for f in files:
            im = cv2.imread(os.path.join(fpath, f))
            h, w = im.shape[:2]
            card_ranges = [(40, 340), (360, 670), (690, 990)]
            
            # Bottom OCR
            bottom = im[int(h * 0.60):h, :]
            scale = 2.5
            up = cv2.resize(bottom, (0,0), fx=scale, fy=scale, interpolation=cv2.INTER_LANCZOS4)
            tmp = os.path.abspath("tmp_bld2.png")
            cv2.imwrite(tmp, up)
            sf = await storage.StorageFile.get_file_from_path_async(tmp)
            st = await sf.open_async(storage.FileAccessMode.READ)
            dec = await imaging.BitmapDecoder.create_async(st)
            bm = await dec.get_software_bitmap_async()
            res = await engine.recognize_async(bm)
            st.close()
            try: os.remove(tmp)
            except: pass
            
            words = []
            for line in res.lines:
                for word in line.words:
                    words.append((word.bounding_rect.y / scale, word.bounding_rect.x / scale, word.bounding_rect.width / scale, word.text))
                    
            for c_idx, (x_min, x_max) in enumerate(card_ranges, start=1):
                if form == "Goal Line" and f.endswith("0096.png") and c_idx in (2, 3):
                    continue
                    
                c_words = [t for y, x, width, t in sorted(words) if 54 <= y <= 66 and x_min <= x <= x_max and t not in ("o", "O")]
                raw_title = " ".join(c_words).strip()
                clean = re.sub(r"[^A-Z0-9]", "", raw_title.upper())
                
                # Check known recoveries
                if form == "4-3" and f.endswith("0107.png") and c_idx == 1:
                    clean = "CROSS3FIRE"
                    raw_title = "Cross 3 Fire"
                elif form == "Dime" and f.endswith("0102.png") and c_idx == 1:
                    clean = "1DOUBLETE"
                    raw_title = "1 Double TE"
                elif form == "Dollar" and f.endswith("0092.png") and c_idx == 2:
                    clean = "DTMIKELOOP0"
                    raw_title = "DT Mike Loop 0"
                elif form == "Goal Line" and f.endswith("0093.png") and c_idx == 1:
                    clean = "60OUT"
                    raw_title = "60 Out"
                elif form == "Prevent" and f.endswith("0092.png") and c_idx == 1:
                    clean = "MAN3DEEP"
                    raw_title = "Man 3 Deep"
                elif form == "3-3-5" and f.endswith("0092.png") and c_idx == 3:
                    clean = "COVER4URTERS"
                    raw_title = "Cover 4 Quarters"
                elif form == "3-3-5" and f.endswith("0096.png") and c_idx == 1:
                    clean = "COVER9"
                    raw_title = "Cover 9"
                    
                # Determine set
                s_num = int(f.split("_")[-1].split(".")[0])
                if form == "3-3-5": set_name = "Penny"
                elif form == "4-3":
                    if s_num in (92, 93, 94, 95, 96, 97): set_name = "Over"
                    elif s_num in (98, 99, 100, 101, 102, 103): set_name = "Under"
                    elif s_num in (104, 105, 106, 107): set_name = "Odd Leo"
                    else: set_name = "Over Solid"
                elif form == "46": set_name = "Bear Under"
                elif form == "Dime":
                    if s_num <= 103: set_name = "2-3"
                    else: set_name = "Rush"
                elif form == "Dollar": set_name = "3-2 Mug"
                elif form == "Goal Line":
                    if s_num in (92, 93): set_name = "6-2"
                    elif s_num in (94, 95): set_name = "5-3"
                    else: set_name = "6-2"
                elif form == "Prevent": set_name = "3 Deep"
                elif form == "Nickel":
                    if s_num <= 105: set_name = "Over"
                    elif s_num <= 110: set_name = "2-4 Dbl Mug"
                    elif s_num <= 115: set_name = "2-4 Load Mug"
                    elif s_num <= 121: set_name = "Swap Dbl Mug"
                    elif s_num <= 126: set_name = "2-4 Odd Mug"
                    else: set_name = "Wide"
                    
                # Resolve play name and type
                if clean in def_repairs:
                    pname, ptype = def_repairs[clean]
                elif clean in m26_canon:
                    pname, ptype = m26_canon[clean]
                else:
                    m = difflib.get_close_matches(clean, list(m26_canon.keys()), n=1, cutoff=0.7)
                    if m: pname, ptype = m26_canon[m[0]]
                    else: pname, ptype = raw_title, "ZONE"
                    
                rows.append(("CHI", form, set_name, pname, ptype, f, c_idx))

    print(f"Total extracted rows: {len(rows)}")
    
    # Check deduplication
    deduped = []
    seen = set()
    for r in rows:
        k = (r[1], r[2], r[3])
        if k not in seen:
            seen.add(k)
            deduped.append(r)
        else:
            print(f"Duplicate found: {k} from {r[5]} C{r[6]}")
            
    print(f"\nTotal unique plays in defense: {len(deduped)}")
    c = Counter((r[1], r[2]) for r in deduped)
    form_totals = Counter(r[1] for r in deduped)
    for form_name, tot in sorted(form_totals.items()):
        print(f"=== {form_name:12}: {tot:3d} plays ===")
        for (f, s), count in sorted(c.items()):
            if f == form_name:
                print(f"     {s:18} : {count:2d} plays")
        
    # Write final Bears_defensive_playbook.xlsx
    out_path = r"D:\Robert\Desktop\App Project Builds\Gridiron_OC\Gridiron_OC\imports\Madden 27 Team Playbook (Excel Workbooks)\Bears_defensive_playbook.xlsx"
    wb_out = openpyxl.Workbook()
    ws_out = wb_out.active
    ws_out.title = "Defensive Plays"
    ws_out.append(["Team", "Formation", "Set", "Play Name", "Type"])
    for cell in ws_out[1]: cell.font = openpyxl.styles.Font(bold=True)
    for r in sorted(deduped, key=lambda x: (x[1], x[2], x[3])):
        ws_out.append([r[0], r[1], r[2], r[3], r[4]])

    summary = wb_out.create_sheet("By Formation Set")
    summary.append(["Formation", "Set", "Play Count"])
    for cell in summary[1]: cell.font = openpyxl.styles.Font(bold=True)
    for (f, s), count in sorted(c.items()):
        summary.append([f, s, count])

    types = wb_out.create_sheet("By Type")
    types.append(["Type", "Count"])
    for cell in types[1]: cell.font = openpyxl.styles.Font(bold=True)
    t_counts = Counter(r[4] for r in deduped)
    for pt, count in sorted(t_counts.items()):
        types.append([pt, count])

    wb_out.save(out_path)
    print(f"\nSaved verified defense playbook to {out_path}!")

asyncio.run(build_exact_defense())
