import os
import sys
import re
import asyncio
import cv2
import numpy as np
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from openpyxl import Workbook
from openpyxl.styles import Font

import winsdk.windows.graphics.imaging as imaging
import winsdk.windows.media.ocr as ocr
import winsdk.windows.storage as storage

@dataclass
class PlayRow:
    team: str
    formation: str
    set_name: str
    play_name: str
    play_type: str
    source_file: str
    card_index: int

# Type badges: BGR color bounds
def classify_badge(crop):
    # crop is BGR
    b, g, r = [float(np.mean(crop[:, :, i])) for i in range(3)]
    # Run: Red badge (r > 80, r > g + 25, r > b + 25)
    if r > 80 and r > g + 25 and r > b + 25:
        return "RUN"
    # Pass: Blue badge (b > 80, b > r + 30)
    if b > 80 and b > r + 30:
        return "PASS"
    # Blitz: Red badge
    if r > 80 and r > g + 25 and r > b + 25:
        return "BLITZ"
    # Match: Purple badge (high r and high b, low g)
    if r > 60 and b > 80 and g < 65 and abs(r - b) < 40:
        return "MATCH"
    # Zone: Blue badge
    if b > 80 and b > r + 20:
        return "ZONE"
    # Man: Orange badge (r > 100, 40 < g < 90, b < 40)
    if r > 90 and g > 40 and b < 50:
        return "MAN"
    return "PASS"

def normalize_play_name(raw_text):
    t = re.sub(r"\s+", " ", str(raw_text or "").strip()).upper()
    # Strip leading button/circle artifact characters
    t = re.sub(r"^[Oo0]\s+", "", t)
    t = re.sub(r"^[-–—]\s*", "", t)
    t = re.sub(r"[—–']+", "", t)
    
    # Common OCR repairs
    repairs = [
        (r"\b14B\b", "HB"),
        (r"\bHBCOUUTERWK\b", "HB COUNTER WK"),
        (r"\bHBCOIJUTERWK\b", "HB COUNTER WK"),
        (r"\bHBSPUTO\b", "HB SPLIT O"),
        (r"\bHBSPLITO\b", "HB SPLIT O"),
        (r"\bSTmNGTOSS\b", "STRONG TOSS"),
        (r"\bSTETOSS\b", "STRONG TOSS"),
        (r"\bSTMGTOSS\b", "STRONG TOSS"),
        (r"\bPWERO\b", "POWER O"),
        (r"\bPOWERO\b", "POWER O"),
        (r"\bPAPWERO\b", "PA POWER O"),
        (r"\bPAPOWERO\b", "PA POWER O"),
        (r"\bPASPRINTHBFUT\b", "PA SPRINT HB FLAT"),
        (r"\bPASPRINTHBFLAT\b", "PA SPRINT HB FLAT"),
        (r"\bPASPOT\b", "PA SPOT"),
        (r"\bQBSNEAK\b", "QB SNEAK"),
        (r"\bQBSNEAX\b", "QB SNEAK"),
        (r"\bFBDIVEWEAK\b", "FB DIVE WEAK"),
        (r"\bFBDIVEWEAI\b", "FB DIVE WEAK"),
        (r"\bPAWAGGLE\b", "PA WAGGLE"),
        (r"\bCWER8SKY\b", "COVER 3 SKY"),
        (r"\bCOVER8SKY\b", "COVER 3 SKY"),
        (r"\bCWER8MATCH\b", "COVER 3 MATCH"),
        (r"\bCOVER8MATCH\b", "COVER 3 MATCH"),
        (r"\bPINCHBUTZO\b", "PINCH BLITZ 0"),
        (r"\bCOVER4WARTERS\b", "COVER 4 QUARTERS"),
        (r"\bCOVER4URTERS\b", "COVER 4 QUARTERS"),
        (r"\bSAWBUTZ8\b", "SAW BLITZ 3"),
        (r"\bSAWBUTZ3\b", "SAW BLITZ 3"),
        (r"\bSAWBUTZI\b", "SAW BLITZ 1"),
        (r"\bCOVERHOLEI\b", "COVER HOLE 1"),
        (r"\bCN4PALUS\b", "COVER 4 PALMS"),
        (r"\bCWEUPALUS\b", "COVER 4 PALMS"),
        (r"\bHOTBLlTZ8\b", "HOT BLITZ 3"),
        (r"\bCOVERIOBER\b", "COVER 1 ROBBER"),
        (r"\bCOVERG\b", "COVER 6"),
        (r"\bCOVERS\b", "COVER 6"),
        (r"\bCORNERBUTZ3\b", "CORNER BLITZ 3"),
        (r"\bCORNER BUTZ3\b", "CORNER BLITZ 3"),
        (r"\bDMJBLEBUCKET\b", "DOUBLE BRACKET"),
        (r"\bSLOTBUTZ8\b", "SLOT BLITZ 3"),
        (r"\bSLOTBUTZ3\b", "SLOT BLITZ 3"),
        (r"\bCOVER6WlLLlE\b", "COVER 6 WILLE"),
        (r"\bCOVERGWILLIE\b", "COVER 6 WILLE"),
        (r"\bCOVER8BlRZ\b", "COVER 3 BUZZ"),
        (r"\bUMPA2\b", "TAMPA 2"),
        (r"\bTAUPA2\b", "TAMPA 2"),
        (r"\bSAMMIKE8PRESS\b", "SAM MIKE 3 PRESS"),
        (r"\bSAM MIKE8PRESS\b", "SAM MIKE 3 PRESS"),
        (r"\bMIKEBLITZI\b", "MIKE BLITZ 1"),
        (r"\bCORUERBLlTZ2\b", "CORNER BLITZ 2"),
        (r"\bCORERBLlTZ2\b", "CORNER BLITZ 2"),
        (r"\bINSIDEZONE\b", "INSIDE ZONE"),
        (r"\bMESHSPOT\b", "MESH SPOT"),
        (r"\bHBPUNCH\b", "HB PUNCH"),
        (r"\bBENCHSWAP\b", "BENCH SWAP"),
        (r"\bREADOPTION\b", "READ OPTION"),
        (r"\bSEAMSZ-UUDER\b", "SEAMS Z-UNDER"),
        (r"\bHBPDNER\b", "HB POWER"),
        (r"\bPADAGGER\b", "PA DAGGER"),
        (r"\bMTNRPOBUCKPEEKSLANT\b", "MTN RPO BUCK PEEK SLANT"),
        (r"\bMTNPAFKSCREENSCISSORS\b", "MTN PA FK SCREEN SCISSORS"),
        (r"\bMTNRPOALERTBUBBLE\b", "MTN RPO ALERT BUBBLE"),
        (r"\bFOURVERTICLS\b", "FOUR VERTICALS"),
        (r"\bFOURVERTICALS\b", "FOUR VERTICALS"),
        (r"\bHBSCISSORS\b", "HB SCISSORS"),
        (r"\bEDGEBUTZO\b", "EDGE BLITZ 0"),
        (r"\bCOVER8BUZZMATCH\b", "COVER 3 BUZZ MATCH"),
        (r"\bOVERSTORMBRAVE\b", "OVER STORM BRAVE"),
        (r"\bFSWIUBUTZO\b", "FS WILL BLITZ 0"),
        (r"\bOVERLOADBLITZ\b", "OVERLOAD BLITZ"),
        (r"\bCOVER8SHOW2\b", "COVER 3 SHOW 2"),
        (r"\bOVERLOAD8SEAU\b", "OVERLOAD 3 SEAM"),
    ]
    for pattern, repl in repairs:
        t = re.sub(pattern, repl, t, flags=re.I)
    
    t = re.sub(r"\bBUTZ\b", "BLITZ", t)
    t = re.sub(r"\bBLlTZ\b", "BLITZ", t)
    return re.sub(r"\s+", " ", t).strip()

def normalize_set_name(raw_text):
    s = re.sub(r"\s+", " ", str(raw_text or "").strip())
    s = re.sub(r"^[Oo0]\s+", "", s)
    s = re.sub(r"[—–']+", "", s)
    
    # Specific repairs
    repairs = [
        (r"\bWING TIGHTNASTY\b", "Wing Tight Nasty"),
        (r"\bWINGTIGHTUSTY\b", "Wing Tight Nasty"),
        (r"\bWINGSIOTOFFSET\b", "Wing Slot Offset"),
        (r"\bWING SLOT OFFSET\b", "Wing Slot Offset"),
        (r"\bWINGFIEXOFFSETWK\b", "Wing Flex Offset Wk"),
        (r"\bWING FLEX OFFSET WK\b", "Wing Flex Offset Wk"),
        (r"\bDEUCE CLOSE\b", "Deuce Close"),
        (r"\bDOUBLES HBWK\b", "Doubles HB Wk"),
        (r"\bDOUBLES HB WK\b", "Doubles HB Wk"),
        (r"\bNORMAL Y OFF CLOSE\b", "Normal Y Off Close"),
        (r"\bSLOT RIGHT\b", "Slot Right"),
        (r"\bRIGHT j\b", "Slot Right"),
        (r"\bY OFF TRIPS\b", "Y Off Trips"),
        (r"\bYOFFTRIOWK\b", "Y Off Trips Wk"),
        (r"\bY OFF TRIPS WK\b", "Y Off Trips Wk"),
        (r"\bTIGHT OPEN\b", "Tight Open"),
        (r"\bEMPTY CHIPS QUADS\b", "Empty Chips Quads"),
        (r"\b2-4 DBL MUG\b", "2-4 Dbl Mug"),
        (r"\b2-4LODMUG\b", "2-4 Load Mug"),
        (r"\b2-4 LOAD MUG\b", "2-4 Load Mug"),
        (r"\bSWAPDBLMUG\b", "Swap Dbl Mug"),
        (r"\bSWAP DBL MUG\b", "Swap Dbl Mug"),
        (r"\b2-4 ODD DBL MUG\b", "2-4 Odd Dbl Mug"),
        (r"\bPENNY\b", "Penny"),
        (r"\bNORMAL\b", "Normal"),
    ]
    for pattern, repl in repairs:
        s = re.sub(pattern, repl, s, flags=re.I)
    return s.strip()
