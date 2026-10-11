"""Controlled vocabularies for the vineyard onboarding template.

Single source of truth: build_vineyard_template.py uses these lists for the
Excel dropdowns, and import_vineyard.py validates returned templates against
the same lists, so what a winery can pick is exactly what the engine expects.
"""

STYLES = ["Red", "White", "Rosé", "Sparkling", "Dessert / fortified"]
# How each template style is stored in the engine's data (the match tool's
# style buttons use these values).
STYLE_TO_ENGINE = {"Dessert / fortified": "Dessert"}

VARIETIES = [
    # Red
    "Shiraz", "Cabernet Sauvignon", "Merlot", "Pinot Noir", "Grenache",
    "Mataro / Mourvèdre", "Tempranillo", "Sangiovese", "Nebbiolo", "Barbera",
    "Malbec", "Petit Verdot", "Cabernet Franc", "Durif", "Montepulciano",
    "Nero d'Avola", "Touriga Nacional", "Zinfandel / Primitivo", "Red blend",
    # White
    "Chardonnay", "Sauvignon Blanc", "Semillon", "Riesling", "Pinot Gris / Grigio",
    "Viognier", "Fiano", "Vermentino", "Verdelho", "Marsanne", "Roussanne",
    "Chenin Blanc", "Gewürztraminer", "Grüner Veltliner", "Albariño", "Moscato",
    "Semillon Sauvignon Blanc", "White blend",
    # Sparkling / dessert / fortified
    "Chardonnay Pinot Noir (sparkling)", "Sparkling Shiraz", "Prosecco",
    "Muscat", "Topaque", "Tawny", "Other (see comments)",
]

# Australian wine regions (Geographical Indications), with the state each
# belongs to. Some subregions are listed because wineries use them.
REGIONS = {
    "New South Wales": [
        "Hunter Valley", "Broke Fordwich", "Mudgee", "Orange", "Cowra", "Hilltops", "Canberra District",
        "Tumbarumba", "Gundagai", "Riverina", "Perricoota", "Southern Highlands",
        "Shoalhaven Coast", "Hastings River", "New England Australia",
        "Murray Darling", "Swan Hill",  # both straddle the NSW/Victoria border
    ],
    "Victoria": [
        "Yarra Valley", "Mornington Peninsula", "Geelong", "Macedon Ranges", "Sunbury",
        "Heathcote", "Bendigo", "Goulburn Valley", "Nagambie Lakes", "Upper Goulburn", "Strathbogie Ranges",
        "Rutherglen", "Beechworth", "Alpine Valleys", "King Valley", "Glenrowan",
        "Grampians", "Great Western", "Pyrenees", "Henty", "Ballarat", "Gippsland", "Murray Darling",
        "Swan Hill",
    ],
    "South Australia": [
        "Barossa Valley", "Eden Valley", "Clare Valley", "McLaren Vale", "Adelaide Hills",
        "Coonawarra", "Langhorne Creek", "Padthaway", "Wrattonbully", "Mount Benson",
        "Robe", "Mount Gambier", "Riverland", "Currency Creek", "Kangaroo Island",
        "Southern Fleurieu", "Adelaide Plains", "Southern Flinders Ranges",
    ],
    "Western Australia": [
        "Margaret River", "Great Southern", "Albany", "Denmark", "Frankland River",
        "Mount Barker", "Porongurup", "Swan District", "Swan Valley", "Perth Hills",
        "Peel", "Geographe", "Blackwood Valley", "Manjimup", "Pemberton",
    ],
    "Tasmania": ["Tasmania"],
    "Queensland": ["Granite Belt", "South Burnett"],
    "Australian Capital Territory": ["Canberra District"],
    "Northern Territory": [],
}
OTHER_REGION = "Other (see comments)"


def region_list():
    seen, out = set(), []
    for regions in REGIONS.values():
        for r in regions:
            if r not in seen:
                seen.add(r)
                out.append(r)
    return sorted(out) + [OTHER_REGION]


def state_for_region(region):
    for state, regions in REGIONS.items():
        if region in regions:
            return state
    return None


STATES = list(REGIONS.keys())
BODY = ["Light", "Medium", "Full"]
SWEETNESS = ["Dry", "Off-dry", "Medium sweet", "Sweet"]
OAK = ["Unoaked", "Lightly oaked", "Oaked"]
FLAVOURS = sorted([
    "Blackberry", "Blackcurrant", "Cherry", "Plum", "Raspberry", "Strawberry",
    "Red berries", "Dark fruit", "Citrus", "Lemon", "Lime", "Grapefruit",
    "Green apple", "Pear", "Stone fruit", "Peach", "Apricot", "Tropical fruit",
    "Passionfruit", "Melon", "Floral", "Violet", "Rose", "Herbal", "Mint / eucalyptus",
    "Pepper", "Spice", "Cinnamon", "Vanilla", "Oak", "Toast", "Smoke",
    "Chocolate", "Coffee", "Licorice", "Leather", "Tobacco", "Earthy", "Mineral",
    "Honey", "Nutty", "Brioche", "Butter", "Savoury",
])
VINTAGES = ["NV"] + [str(y) for y in range(2026, 1994, -1)]
BOTTLE_SIZES = ["750 ml", "375 ml", "500 ml", "1.5 L (magnum)", "Other (see comments)"]
CLOSURES = ["Screwcap", "Cork", "Other"]
EXPORTED_BEFORE = ["Never exported", "Exported before"]
AWARDS = ["None", "Bronze medal", "Silver medal", "Gold medal", "Trophy", "Other (see comments)"]

# Vineyard details
OWNERSHIP = ["Family-owned", "Independent (not family-owned)", "Part of a larger wine group"]
YEARS_OPERATING = ["Under 5 years", "5–10 years", "11–20 years", "21–50 years", "Over 50 years"]
YEARS_MIDPOINT = {"Under 5 years": 3, "5–10 years": 8, "11–20 years": 15, "21–50 years": 35, "Over 50 years": 60}
PRODUCTION = ["Under 1,000 cases", "1,000–5,000 cases", "5,000–20,000 cases", "Over 20,000 cases"]
PRODUCTION_TO_SCALE = {
    "Under 1,000 cases": "Small-batch producer",
    "1,000–5,000 cases": "Boutique producer",
    "5,000–20,000 cases": "Mid-sized producer",
    "Over 20,000 cases": "Established producer",
}
EXPORT_EXPERIENCE = ["Never exported", "Exported occasionally", "Export regularly"]
CERTIFICATIONS = [
    "None", "Certified organic", "Certified biodynamic", "In conversion to organic",
    "Sustainable Winegrowing Australia member", "Other (see comments)",
]
DELIVERY = ["We can deliver to Melbourne", "Pick-up needed", "Not sure"]
YES_NO = ["Yes", "No"]
REGISTERED = ["Yes, registered wine producer", "No / not sure"]
# Sapphire Panda sets the minimum order (12 bottles); vineyards accept it or
# aren't featured.
MIN_ORDER = 12
ACCEPT_MIN_ORDER = ["Yes, I accept", "No"]
