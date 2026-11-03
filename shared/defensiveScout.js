(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.GridironDefensiveScout = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function cleanText(value) {
    return String(value == null ? "" : value).trim();
  }

  var SCOUT_TEAMS = {
    ARI: {
      team: "Arizona Cardinals",
      code: "ARI",
      baseFront: "3-4 Under",
      frontType: "odd",
      identity: "Bend-Don't-Break",
      coverageShell: "Cover 3 / Cover 4",
      primaryWeakness: "Vulnerable to Out routes, Screens, and Outside Zone runs.",
      weaknessConcepts: ["Out", "Screen", "Wide Zone", "Stretch", "Quick Game"],
      weaknessFamilies: ["quick_game", "screen", "outside_zone", "spacing_snag"],
      shellDistribution: [["Cover 3", 0.55], ["Cover 4", 0.45]]
    },
    ATL: {
      team: "Atlanta Falcons",
      code: "ATL",
      baseFront: "3-4 Base",
      frontType: "odd",
      identity: "Disguise",
      coverageShell: "Cover 3 Match",
      primaryWeakness: "Weak against Play-Action crossers and Flood concepts.",
      weaknessConcepts: ["Play Action", "Cross", "Deep Over", "Flood", "Sail"],
      weaknessFamilies: ["cross", "flood", "play_action", "sail"],
      shellDistribution: [["Cover 3", 0.70], ["Cover 1", 0.30]]
    },
    BAL: {
      team: "Baltimore Ravens",
      code: "BAL",
      baseFront: "3-4 Odd",
      frontType: "odd",
      identity: "Blitz-Heavy",
      coverageShell: "Cover 1 / Cover 3",
      primaryWeakness: "Vulnerable to Hot reads, Slants, and HB Slip Screens.",
      weaknessConcepts: ["Quick Game", "Slant", "Screen", "Flat", "Drag"],
      weaknessFamilies: ["slant", "screen", "quick_game", "drive_shallow"],
      shellDistribution: [["Cover 1", 0.50], ["Cover 3", 0.30], ["Cover 0", 0.20]]
    },
    BUF: {
      team: "Buffalo Bills",
      code: "BUF",
      baseFront: "4-3 Over",
      frontType: "even",
      identity: "Disguise",
      coverageShell: "Cover 2 / Cover 4 Palms",
      primaryWeakness: "Weak to Inside Zone runs and Middle High-Low concepts (Hi-Lo).",
      weaknessConcepts: ["Inside Zone", "Dagger", "Drag", "Under", "Seam"],
      weaknessFamilies: ["inside_zone", "levels_dig", "drive_shallow"],
      shellDistribution: [["Cover 2", 0.55], ["Cover 4", 0.45]]
    },
    CAR: {
      team: "Carolina Panthers",
      code: "CAR",
      baseFront: "3-4 Base",
      frontType: "odd",
      identity: "Bend-Don't-Break",
      coverageShell: "Cover 3 Zone",
      primaryWeakness: "Susceptible to Quick Game (Hitches/Slants) and Power O runs.",
      weaknessConcepts: ["Quick Game", "Slant", "Curl", "Power O", "Counter"],
      weaknessFamilies: ["quick_game", "slant", "power_counter"],
      shellDistribution: [["Cover 3", 0.75], ["Cover 4", 0.25]]
    },
    CHI: {
      team: "Chicago Bears",
      code: "CHI",
      baseFront: "4-3 Even",
      frontType: "even",
      identity: "Base Zone",
      coverageShell: "Cover 2 / Tampa 2",
      primaryWeakness: "Weak against Seam routes (TE Verticals) and Smash concepts.",
      weaknessConcepts: ["Seam", "Verticals", "Smash", "Corner", "Flat"],
      weaknessFamilies: ["smash", "shot", "bench", "corner"],
      shellDistribution: [["Tampa 2", 0.50], ["Cover 2", 0.50]]
    },
    CIN: {
      team: "Cincinnati Bengals",
      code: "CIN",
      baseFront: "4-3 Over",
      frontType: "even",
      identity: "Disguise",
      coverageShell: "Cover 1 / Cover 3",
      primaryWeakness: "Vulnerable to deep Post-Corner routes and Draw plays.",
      weaknessConcepts: ["Post", "Corner", "Draw"],
      weaknessFamilies: ["post_corner", "corner", "draw"],
      shellDistribution: [["Cover 3", 0.55], ["Cover 1", 0.45]]
    },
    CLE: {
      team: "Cleveland Browns",
      code: "CLE",
      baseFront: "4-3 Over",
      frontType: "even",
      identity: "Aggressive Man",
      coverageShell: "Cover 1 / Cover 3 Press",
      primaryWeakness: "Weak against Double Moves, Mesh concepts, and Wheel routes.",
      weaknessConcepts: ["Mesh", "Wheel", "Deep Over"],
      weaknessFamilies: ["mesh", "wheel", "shot"],
      shellDistribution: [["Cover 1", 0.60], ["Cover 3", 0.40]]
    },
    DAL: {
      team: "Dallas Cowboys",
      code: "DAL",
      baseFront: "4-3 Under",
      frontType: "even",
      identity: "Blitz-Heavy",
      coverageShell: "Cover 1 / Cover 3 Sky",
      primaryWeakness: "Susceptible to Screen plays, RPOs, and Outside Zone.",
      weaknessConcepts: ["Screen", "RPO", "Wide Zone", "Stretch"],
      weaknessFamilies: ["screen", "rpo", "outside_zone"],
      shellDistribution: [["Cover 1", 0.50], ["Cover 3", 0.50]]
    },
    DEN: {
      team: "Denver Broncos",
      code: "DEN",
      baseFront: "3-4 Odd",
      frontType: "odd",
      identity: "Blitz-Heavy",
      coverageShell: "Cover 1 / Cover 3 Press",
      primaryWeakness: "Vulnerable to Quick Slants, Texan angles, and HB Out patterns.",
      weaknessConcepts: ["Slant", "Out", "Quick Game", "Drag"],
      weaknessFamilies: ["slant", "quick_game", "drive_shallow"],
      shellDistribution: [["Cover 1", 0.55], ["Cover 3", 0.45]]
    },
    DET: {
      team: "Detroit Lions",
      code: "DET",
      baseFront: "4-3 Under",
      frontType: "even",
      identity: "Aggressive Man",
      coverageShell: "Cover 1 / Cover 2 Man",
      primaryWeakness: "Weak against Curl-Flat concepts, Mesh, and Mobile QB Scrambles.",
      weaknessConcepts: ["Curl", "Flat", "Mesh"],
      weaknessFamilies: ["curl_flat", "mesh", "cross"],
      shellDistribution: [["Cover 1", 0.60], ["Cover 2", 0.40]]
    },
    GB: {
      team: "Green Bay Packers",
      code: "GB",
      baseFront: "4-3 Over",
      frontType: "even",
      identity: "Aggressive Zone",
      coverageShell: "Cover 3 / Cover 1",
      primaryWeakness: "Susceptible to RPOs, Play-Action bootlegs, and Levels concepts.",
      weaknessConcepts: ["RPO", "Boot", "Play Action", "Dagger", "Drag"],
      weaknessFamilies: ["rpo", "boot", "levels_dig"],
      shellDistribution: [["Cover 3", 0.60], ["Cover 1", 0.40]]
    },
    HOU: {
      team: "Houston Texans",
      code: "HOU",
      baseFront: "4-3 Wide",
      frontType: "even",
      identity: "Aggressive Zone",
      coverageShell: "Cover 3 Sky",
      primaryWeakness: "Vulnerable to Inside Zone/Trap runs and Floods to the boundary.",
      weaknessConcepts: ["Inside Zone", "Trap", "Flood", "Out"],
      weaknessFamilies: ["inside_zone", "trap", "flood"],
      shellDistribution: [["Cover 3", 0.80], ["Cover 4", 0.20]]
    },
    IND: {
      team: "Indianapolis Colts",
      code: "IND",
      baseFront: "4-3 Even",
      frontType: "even",
      identity: "Base Zone",
      coverageShell: "Cover 3 Sky",
      primaryWeakness: "Highly vulnerable to Underneath Checkdowns and Curls.",
      weaknessConcepts: ["Curl", "Stick", "Quick Game", "Spacing"],
      weaknessFamilies: ["curl_flat", "spacing_snag", "quick_game"],
      shellDistribution: [["Cover 3", 0.75], ["Cover 2", 0.25]]
    },
    JAX: {
      team: "Jacksonville Jaguars",
      code: "JAX",
      baseFront: "4-3 Under",
      frontType: "even",
      identity: "Disguise",
      coverageShell: "Cover 3 Match / Cover 1",
      primaryWeakness: "Weak against Deep Crossers and HB choice routes.",
      weaknessConcepts: ["Cross", "Deep Over", "Play Action", "Out"],
      weaknessFamilies: ["cross", "drive_shallow", "levels_dig"],
      shellDistribution: [["Cover 3", 0.60], ["Cover 1", 0.40]]
    },
    KC: {
      team: "Kansas City Chiefs",
      code: "KC",
      baseFront: "3-4 Under",
      frontType: "odd",
      identity: "Blitz-Heavy",
      coverageShell: "Cover 1 / Cover 0",
      primaryWeakness: "Highly vulnerable to RB Screens, Max Protect deep shots, and Slants.",
      weaknessConcepts: ["Screen", "Deep Over", "Slant", "Shot"],
      weaknessFamilies: ["screen", "shot", "slant"],
      shellDistribution: [["Cover 1", 0.55], ["Cover 0", 0.45]]
    },
    LV: {
      team: "Las Vegas Raiders",
      code: "LV",
      baseFront: "3-4 Under",
      frontType: "odd",
      identity: "Disguise",
      coverageShell: "Cover 3 / Cover 2",
      primaryWeakness: "Weak against Stretch runs and Levels concepts.",
      weaknessConcepts: ["Wide Zone", "Stretch", "Dagger", "Drag"],
      weaknessFamilies: ["outside_zone", "levels_dig"],
      shellDistribution: [["Cover 3", 0.60], ["Cover 2", 0.40]]
    },
    LAC: {
      team: "Los Angeles Chargers",
      code: "LAC",
      baseFront: "3-4 Odd",
      frontType: "odd",
      identity: "Disguise",
      coverageShell: "Cover 3 Match",
      primaryWeakness: "Vulnerable to Quick Game, Angle routes, and Dive runs.",
      weaknessConcepts: ["Quick Game", "Dive", "Drag"],
      weaknessFamilies: ["quick_game", "dive", "drive_shallow"],
      shellDistribution: [["Cover 3", 0.65], ["Cover 1", 0.35]]
    },
    LAR: {
      team: "Los Angeles Rams",
      code: "LAR",
      baseFront: "3-4 Base",
      frontType: "odd",
      identity: "Bend-Don't-Break",
      coverageShell: "Cover 3 / Cover 4",
      primaryWeakness: "Weak to Smash concepts, Deep Outs, and Power runs.",
      weaknessConcepts: ["Corner", "Flat", "Out", "Power O"],
      weaknessFamilies: ["smash", "power_counter", "bench"],
      shellDistribution: [["Cover 3", 0.55], ["Cover 4", 0.45]]
    },
    MIA: {
      team: "Miami Dolphins",
      code: "MIA",
      baseFront: "3-4 Odd",
      frontType: "odd",
      identity: "Blitz-Heavy",
      coverageShell: "Cover 1 Press",
      primaryWeakness: "Vulnerable to Mesh, Bubble Screens, and Deep Wheel routes.",
      weaknessConcepts: ["Mesh", "Screen", "Wheel"],
      weaknessFamilies: ["mesh", "screen", "wheel"],
      shellDistribution: [["Cover 1", 0.65], ["Cover 0", 0.35]]
    },
    MIN: {
      team: "Minnesota Vikings",
      code: "MIN",
      baseFront: "3-4 Even / Dollar",
      frontType: "odd",
      identity: "Blitz-Heavy",
      coverageShell: "Cover 0 / Cover 3 Cloud",
      primaryWeakness: "High risk of zero-blitz. Weak to Quick RPOs, Slants, Screens.",
      weaknessConcepts: ["RPO", "Slant", "Screen", "Quick Game"],
      weaknessFamilies: ["rpo", "slant", "screen"],
      shellDistribution: [["Cover 0", 0.55], ["Cover 3", 0.45]]
    },
    NE: {
      team: "New England Patriots",
      code: "NE",
      baseFront: "3-4 Hybrid",
      frontType: "odd",
      identity: "Disguise",
      coverageShell: "Cover 1 / Cover 2",
      primaryWeakness: "Weak to Play-Action, Deep Posts, and Outside Zone.",
      weaknessConcepts: ["Play Action", "Post", "Wide Zone", "Stretch"],
      weaknessFamilies: ["play_action", "shot", "outside_zone"],
      shellDistribution: [["Cover 1", 0.55], ["Cover 2", 0.45]]
    },
    NO: {
      team: "New Orleans Saints",
      code: "NO",
      baseFront: "4-3 Even",
      frontType: "even",
      identity: "Aggressive Man",
      coverageShell: "Cover 1 / Cover 2 Man",
      primaryWeakness: "Weak against Mesh, Drag crossers, and Curls.",
      weaknessConcepts: ["Mesh", "Drag", "Curl"],
      weaknessFamilies: ["mesh", "drive_shallow", "curl_flat"],
      shellDistribution: [["Cover 1", 0.60], ["Cover 2", 0.40]]
    },
    NYG: {
      team: "New York Giants",
      code: "NYG",
      baseFront: "3-4 Odd",
      frontType: "odd",
      identity: "Blitz-Heavy",
      coverageShell: "Cover 1 Press",
      primaryWeakness: "Vulnerable to Quick Slants, RPO alerts, and HB Screens.",
      weaknessConcepts: ["Slant", "RPO", "Screen", "Quick Game"],
      weaknessFamilies: ["slant", "rpo", "screen"],
      shellDistribution: [["Cover 1", 0.60], ["Cover 0", 0.40]]
    },
    NYJ: {
      team: "New York Jets",
      code: "NYJ",
      baseFront: "4-3 Over",
      frontType: "even",
      identity: "Base Zone",
      coverageShell: "Cover 3 Sky",
      primaryWeakness: "Weak against Levels, Drive concepts, and Traps.",
      weaknessConcepts: ["Dagger", "Drag", "Trap"],
      weaknessFamilies: ["levels_dig", "drive_shallow", "trap"],
      shellDistribution: [["Cover 3", 0.75], ["Cover 4", 0.25]]
    },
    PHI: {
      team: "Philadelphia Eagles",
      code: "PHI",
      baseFront: "3-4 Hybrid",
      frontType: "odd",
      identity: "Aggressive Zone",
      coverageShell: "Cover 3 / Cover 4 Match",
      primaryWeakness: "Susceptible to Deep Crossers and Inside Runs (Dives).",
      weaknessConcepts: ["Cross", "Deep Over", "Dive", "Inside Zone"],
      weaknessFamilies: ["cross", "dive", "inside_zone"],
      shellDistribution: [["Cover 3", 0.55], ["Cover 4", 0.45]]
    },
    PIT: {
      team: "Pittsburgh Steelers",
      code: "PIT",
      baseFront: "3-4 Odd",
      frontType: "odd",
      identity: "Base Zone",
      coverageShell: "Cover 3 / Cover 2",
      primaryWeakness: "Weak against Flood concepts to the sideline and Trap runs.",
      weaknessConcepts: ["Flood", "Corner", "Flat", "Trap"],
      weaknessFamilies: ["flood", "sail", "trap"],
      shellDistribution: [["Cover 3", 0.60], ["Cover 2", 0.40]]
    },
    SF: {
      team: "San Francisco 49ers",
      code: "SF",
      baseFront: "4-3 Wide",
      frontType: "even",
      identity: "Aggressive Zone",
      coverageShell: "Cover 3 / Cover 4 Quarters",
      primaryWeakness: "Weak against Screen passes, Draw plays, and Seam attacks.",
      weaknessConcepts: ["Screen", "Draw", "Seam"],
      weaknessFamilies: ["screen", "draw", "shot"],
      shellDistribution: [["Cover 3", 0.55], ["Cover 4", 0.45]]
    },
    SEA: {
      team: "Seattle Seahawks",
      code: "SEA",
      baseFront: "3-4 Under",
      frontType: "odd",
      identity: "Disguise",
      coverageShell: "Cover 3 Match",
      primaryWeakness: "Vulnerable to Play-Action deep shots and Levels.",
      weaknessConcepts: ["Play Action", "Deep Over", "Dagger", "Drag"],
      weaknessFamilies: ["play_action", "levels_dig", "shot"],
      shellDistribution: [["Cover 3", 0.70], ["Cover 1", 0.30]]
    },
    TB: {
      team: "Tampa Bay Buccaneers",
      code: "TB",
      baseFront: "3-4 Under",
      frontType: "odd",
      identity: "Blitz-Heavy",
      coverageShell: "Cover 1 / Cover 3",
      primaryWeakness: "Vulnerable to Quick Toss, Slip Screens, and Quick Out routes.",
      weaknessConcepts: ["Screen", "Out", "Quick Game", "Wide Zone"],
      weaknessFamilies: ["screen", "quick_game", "outside_zone"],
      shellDistribution: [["Cover 1", 0.50], ["Cover 3", 0.35], ["Cover 0", 0.15]]
    },
    TEN: {
      team: "Tennessee Titans",
      code: "TEN",
      baseFront: "3-4 Base",
      frontType: "odd",
      identity: "Bend-Don't-Break",
      coverageShell: "Cover 3 Sky",
      primaryWeakness: "Weak against quick rhythm passing and Zone runs.",
      weaknessConcepts: ["Quick Game", "Inside Zone", "Wide Zone", "Stick"],
      weaknessFamilies: ["quick_game", "inside_zone", "outside_zone"],
      shellDistribution: [["Cover 3", 0.80], ["Cover 4", 0.20]]
    },
    WAS: {
      team: "Washington Commanders",
      code: "WAS",
      baseFront: "4-3 Over",
      frontType: "even",
      identity: "Aggressive Zone",
      coverageShell: "Cover 3 Sky",
      primaryWeakness: "Weak against Flood concepts and Counter/Power run plays.",
      weaknessConcepts: ["Flood", "Corner", "Power O", "Counter"],
      weaknessFamilies: ["flood", "power_counter"],
      shellDistribution: [["Cover 3", 0.75], ["Cover 1", 0.25]]
    }
  };

  // Aliases for matching
  var TEAM_ALIASES = {
    "ARIZONA": "ARI",
    "CARDINALS": "ARI",
    "ATLANTA": "ATL",
    "FALCONS": "ATL",
    "BALTIMORE": "BAL",
    "RAVENS": "BAL",
    "BUFFALO": "BUF",
    "BILLS": "BUF",
    "CAROLINA": "CAR",
    "PANTHERS": "CAR",
    "CHICAGO": "CHI",
    "BEARS": "CHI",
    "CINCINNATI": "CIN",
    "BENGALS": "CIN",
    "CLEVELAND": "CLE",
    "BROWNS": "CLE",
    "DALLAS": "DAL",
    "COWBOYS": "DAL",
    "DENVER": "DEN",
    "BRONCOS": "DEN",
    "DETROIT": "DET",
    "LIONS": "DET",
    "GREEN BAY": "GB",
    "PACKERS": "GB",
    "HOUSTON": "HOU",
    "TEXANS": "HOU",
    "INDIANAPOLIS": "IND",
    "COLTS": "IND",
    "JACKSONVILLE": "JAX",
    "JAGUARS": "JAX",
    "KANSAS CITY": "KC",
    "CHIEFS": "KC",
    "LAS VEGAS": "LV",
    "RAIDERS": "LV",
    "LOS ANGELES CHARGERS": "LAC",
    "CHARGERS": "LAC",
    "LOS ANGELES RAMS": "LAR",
    "RAMS": "LAR",
    "MIAMI": "MIA",
    "DOLPHINS": "MIA",
    "MINNESOTA": "MIN",
    "VIKINGS": "MIN",
    "NEW PATRIOTS": "NE",
    "NEW ENGLAND": "NE",
    "PATRIOTS": "NE",
    "NEW ORLEANS": "NO",
    "SAINTS": "NO",
    "NEW YORK GIANTS": "NYG",
    "GIANTS": "NYG",
    "NEW YORK JETS": "NYJ",
    "JETS": "NYJ",
    "PHILADELPHIA": "PHI",
    "EAGLES": "PHI",
    "PITTSBURGH": "PIT",
    "STEELERS": "PIT",
    "SAN FRANCISCO": "SF",
    "49ERS": "SF",
    "SEATTLE": "SEA",
    "SEAHAWKS": "SEA",
    "TAMPA BAY": "TB",
    "BUCCANEERS": "TB",
    "TENNESSEE": "TEN",
    "TITANS": "TEN",
    "WASHINGTON": "WAS",
    "COMMANDERS": "WAS"
  };

  function normalizeScoutCode(teamInput) {
    if (!teamInput) return "";
    var upper = cleanText(teamInput).toUpperCase();
    if (SCOUT_TEAMS[upper]) return upper;
    if (TEAM_ALIASES[upper]) return TEAM_ALIASES[upper];
    var matched = Object.keys(TEAM_ALIASES).find(function (alias) {
      return upper.indexOf(alias) >= 0;
    });
    return matched ? TEAM_ALIASES[matched] : "";
  }

  function getScoutProfile(teamInput) {
    var code = normalizeScoutCode(teamInput);
    return SCOUT_TEAMS[code] || null;
  }

  function scoutShellDistribution(profile) {
    if (!profile || !Array.isArray(profile.shellDistribution) || !profile.shellDistribution.length) {
      return null;
    }
    return {
      observations: 10,
      distribution: {
        total: 10,
        entries: profile.shellDistribution.slice()
      }
    };
  }

  function scorePlayAgainstScout(play, profile, slotIndex) {
    if (!play || !profile) return 0;
    var score = 0;
    var playConcepts = Array.isArray(play.concepts) ? play.concepts : [];
    var playType = cleanText(play.type).toUpperCase();
    var playName = cleanText(play.play_name).toLowerCase();
    var set = cleanText(play.set).toLowerCase();

    // 1. Weakness concept bonus (+2.2 per matching concept)
    var weaknessConcepts = profile.weaknessConcepts || [];
    for (var i = 0; i < weaknessConcepts.length; i += 1) {
      var target = weaknessConcepts[i].toLowerCase();
      var matches = playConcepts.some(function (c) {
        return cleanText(c).toLowerCase().indexOf(target) >= 0;
      }) || playName.indexOf(target) >= 0;
      if (matches) {
        score += 2.2;
        break; // don't over-stack multiple synonyms on the same play
      }
    }

    // 2. Base front alignment for run plays (+1.4)
    if (playType === "RUN") {
      if (profile.frontType === "odd") {
        // Against 3-4 odd front, favor Power, Duo, Counter, Off-Tackle, Outside Zone
        if (playName.indexOf("power") >= 0 || playName.indexOf("duo") >= 0 || playName.indexOf("counter") >= 0 || playName.indexOf("toss") >= 0 || playName.indexOf("stretch") >= 0) {
          score += 1.4;
        }
      } else if (profile.frontType === "even") {
        // Against 4-3 even front, favor Inside Zone, Split Zone, Trap, Iso, Dive
        if (playName.indexOf("inside zone") >= 0 || playName.indexOf("split zone") >= 0 || playName.indexOf("trap") >= 0 || playName.indexOf("dive") >= 0 || playName.indexOf("iso") >= 0) {
          score += 1.4;
        }
      }
    }

    // 3. Playcalling identity tactical adjustments
    if (profile.identity === "Blitz-Heavy") {
      // Reward quick answers, screens, and slants
      if (playName.indexOf("screen") >= 0 || playName.indexOf("slant") >= 0 || playName.indexOf("mesh") >= 0 || playName.indexOf("quick") >= 0) {
        score += 1.8;
      }
      // Slightly penalize slow-developing deep shots on early down slots
      if (slotIndex != null && slotIndex < 5 && (playName.indexOf("deep") >= 0 || playName.indexOf("shot") >= 0) && playType !== "RUN") {
        score -= 0.6;
      }
    } else if (profile.identity === "Bend-Don't-Break") {
      // Reward quick game, hitches, curls, and perimeter runs
      if (playName.indexOf("curl") >= 0 || playName.indexOf("hitch") >= 0 || playName.indexOf("stick") >= 0 || playName.indexOf("out") >= 0) {
        score += 1.6;
      }
    } else if (profile.identity === "Aggressive Man") {
      // Reward crossers, mesh, double moves, and wheels
      if (playName.indexOf("mesh") >= 0 || playName.indexOf("cross") >= 0 || playName.indexOf("wheel") >= 0 || playName.indexOf("pivot") >= 0 || playName.indexOf("whip") >= 0) {
        score += 1.8;
      }
    }

    return score;
  }

  function analyzeOpponentBook(defensivePlays, opponentCode) {
    var code = normalizeScoutCode(opponentCode);
    var profile = SCOUT_TEAMS[code] || null;
    var plays = (Array.isArray(defensivePlays) ? defensivePlays : []).filter(function (p) {
      return cleanText(p && p.team).toUpperCase() === code;
    });

    var counts = {
      total: plays.length,
      blitz: 0,
      zone: 0,
      man: 0,
      match: 0,
      cover3: 0,
      cover2: 0,
      cover4: 0,
      cover1: 0,
      cover0: 0,
      tampa2: 0,
      fronts: {}
    };

    plays.forEach(function (play) {
      var type = cleanText(play.type).toUpperCase();
      if (type === "BLITZ") counts.blitz += 1;
      else if (type === "ZONE") counts.zone += 1;
      else if (type === "MAN") counts.man += 1;
      else if (type === "MATCH") counts.match += 1;

      var name = cleanText(play.play_name).toUpperCase();
      var concepts = Array.isArray(play.concepts) ? play.concepts.map(function (c) { return cleanText(c).toUpperCase(); }) : [];
      var allText = name + " " + concepts.join(" ");

      if (allText.indexOf("COVER 3") >= 0) counts.cover3 += 1;
      if (allText.indexOf("COVER 2") >= 0) counts.cover2 += 1;
      if (allText.indexOf("COVER 4") >= 0) counts.cover4 += 1;
      if (allText.indexOf("COVER 1") >= 0) counts.cover1 += 1;
      if (allText.indexOf("COVER 0") >= 0) counts.cover0 += 1;
      if (allText.indexOf("TAMPA 2") >= 0) counts.tampa2 += 1;

      var formation = cleanText(play.formation);
      if (formation) {
        counts.fronts[formation] = (counts.fronts[formation] || 0) + 1;
      }
    });

    return {
      code: code,
      profile: profile,
      counts: counts
    };
  }

  return {
    SCOUT_TEAMS: SCOUT_TEAMS,
    normalizeScoutCode: normalizeScoutCode,
    getScoutProfile: getScoutProfile,
    scoutShellDistribution: scoutShellDistribution,
    scorePlayAgainstScout: scorePlayAgainstScout,
    analyzeOpponentBook: analyzeOpponentBook
  };
});
