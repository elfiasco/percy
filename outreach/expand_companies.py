"""
Appends ~200 additional companies to metadata.json, focusing on:
  - Fortune 100 / large-cap enterprises with well-maintained IR pages
  - Traditional industries (finance, pharma, industrial, energy, consumer)
    that produce the most templated, standard corporate presentations
  - Companies known to publish quarterly investor decks on Q4 CDN or direct IR

Run once:  python expand_companies.py
"""
import json
from pathlib import Path

META = Path(__file__).parent / "metadata.json"

NEW_COMPANIES = [
    # -------------------------------------------------------------------------
    # TECH GIANTS (not yet in list)
    # -------------------------------------------------------------------------
    {"id":101,"name":"Microsoft","industry":"Tech Giants","domain":"microsoft.com","ticker":"MSFT",
     "ir_url":"https://www.microsoft.com/en-us/investor","search_terms":["Microsoft investor day presentation","Microsoft Build conference deck"],"priority":"high","notes":"Best-in-class PowerPoint output — obvious benchmark for Percy"},
    {"id":102,"name":"Alphabet (Google)","industry":"Tech Giants","domain":"abc.xyz","ticker":"GOOGL",
     "ir_url":"https://abc.xyz/investor","search_terms":["Google investor day presentation","Alphabet earnings deck"],"priority":"high","notes":""},
    {"id":103,"name":"Apple","industry":"Tech Giants","domain":"apple.com","ticker":"AAPL",
     "ir_url":"https://investor.apple.com","search_terms":["Apple investor day presentation","Apple WWDC slides"],"priority":"high","notes":"Keynote-style design — good non-PowerPoint design reference"},
    {"id":104,"name":"Meta","industry":"Tech Giants","domain":"meta.com","ticker":"META",
     "ir_url":"https://investor.fb.com","search_terms":["Meta investor day presentation","Meta Connect conference deck"],"priority":"high","notes":""},
    {"id":105,"name":"Oracle","industry":"Tech Giants","domain":"oracle.com","ticker":"ORCL",
     "ir_url":"https://investor.oracle.com","search_terms":["Oracle investor day presentation","Oracle CloudWorld deck"],"priority":"high","notes":"Very standardized corporate template — great example"},
    {"id":106,"name":"IBM","industry":"Tech Giants","domain":"ibm.com","ticker":"IBM",
     "ir_url":"https://www.ibm.com/investor","search_terms":["IBM investor day deck","IBM Think conference presentation"],"priority":"high","notes":"Classic enterprise deck style"},
    {"id":107,"name":"Cisco Systems","industry":"Tech Giants","domain":"cisco.com","ticker":"CSCO",
     "ir_url":"https://investor.cisco.com","search_terms":["Cisco investor day presentation","Cisco Live conference deck"],"priority":"high","notes":""},
    {"id":108,"name":"Intel","industry":"Tech Giants","domain":"intel.com","ticker":"INTC",
     "ir_url":"https://investor.intel.com","search_terms":["Intel investor day presentation","Intel Innovation conference deck"],"priority":"high","notes":"Heavy use of data charts — good for chart rendering tests"},
    {"id":109,"name":"NVIDIA","industry":"Tech Giants","domain":"nvidia.com","ticker":"NVDA",
     "ir_url":"https://investor.nvidia.com","search_terms":["NVIDIA investor day presentation","NVIDIA GTC conference deck"],"priority":"high","notes":"Dark brand palette — test contrast handling"},
    {"id":110,"name":"Broadcom","industry":"Tech Giants","domain":"broadcom.com","ticker":"AVGO",
     "ir_url":"https://investors.broadcom.com","search_terms":["Broadcom investor day deck","AVGO earnings presentation"],"priority":"high","notes":""},
    {"id":111,"name":"Qualcomm","industry":"Tech Giants","domain":"qualcomm.com","ticker":"QCOM",
     "ir_url":"https://investor.qualcomm.com","search_terms":["Qualcomm investor day presentation","Qualcomm Snapdragon Summit deck"],"priority":"medium","notes":""},
    {"id":112,"name":"Texas Instruments","industry":"Tech Giants","domain":"ti.com","ticker":"TXN",
     "ir_url":"https://investor.ti.com","search_terms":["Texas Instruments investor day deck","TXN earnings presentation"],"priority":"medium","notes":""},
    {"id":113,"name":"HP Inc","industry":"Tech Giants","domain":"hp.com","ticker":"HPQ",
     "ir_url":"https://investor.hp.com","search_terms":["HP Inc investor day deck","HPQ earnings presentation"],"priority":"medium","notes":""},
    {"id":114,"name":"Dell Technologies","industry":"Tech Giants","domain":"dell.com","ticker":"DELL",
     "ir_url":"https://investors.delltechnologies.com","search_terms":["Dell Technologies investor day deck","Dell earnings presentation"],"priority":"medium","notes":""},
    {"id":115,"name":"SAP","industry":"Tech Giants","domain":"sap.com","ticker":"SAP",
     "ir_url":"https://www.sap.com/investors","search_terms":["SAP investor day presentation","SAP Sapphire conference deck"],"priority":"high","notes":"Blue-heavy German enterprise style — good non-US reference"},

    # -------------------------------------------------------------------------
    # FINANCIAL SERVICES GIANTS
    # -------------------------------------------------------------------------
    {"id":116,"name":"JPMorgan Chase","industry":"Financial Services","domain":"jpmorganchase.com","ticker":"JPM",
     "ir_url":"https://www.jpmorganchase.com/ir","search_terms":["JPMorgan investor day presentation","JPM earnings deck"],"priority":"high","notes":"Gold standard for financial services deck design"},
    {"id":117,"name":"Goldman Sachs","industry":"Financial Services","domain":"goldmansachs.com","ticker":"GS",
     "ir_url":"https://www.goldmansachs.com/investor-relations","search_terms":["Goldman Sachs investor day deck","GS earnings presentation"],"priority":"high","notes":"Very data-dense, high-quality financial decks"},
    {"id":118,"name":"Morgan Stanley","industry":"Financial Services","domain":"morganstanley.com","ticker":"MS",
     "ir_url":"https://www.morganstanley.com/about-us-ir","search_terms":["Morgan Stanley investor day deck","MS earnings presentation"],"priority":"high","notes":""},
    {"id":119,"name":"Bank of America","industry":"Financial Services","domain":"bankofamerica.com","ticker":"BAC",
     "ir_url":"https://investor.bankofamerica.com","search_terms":["Bank of America investor day presentation","BAC earnings deck"],"priority":"high","notes":""},
    {"id":120,"name":"Citigroup","industry":"Financial Services","domain":"citigroup.com","ticker":"C",
     "ir_url":"https://www.citigroup.com/global/investors","search_terms":["Citigroup investor day presentation","Citi earnings deck"],"priority":"high","notes":""},
    {"id":121,"name":"Wells Fargo","industry":"Financial Services","domain":"wellsfargo.com","ticker":"WFC",
     "ir_url":"https://www.wellsfargo.com/about/investor-relations","search_terms":["Wells Fargo investor day deck","WFC earnings presentation"],"priority":"high","notes":""},
    {"id":122,"name":"BlackRock","industry":"Financial Services","domain":"blackrock.com","ticker":"BLK",
     "ir_url":"https://ir.blackrock.com","search_terms":["BlackRock investor day presentation","BLK earnings deck"],"priority":"high","notes":"World's largest asset manager — polished institutional decks"},
    {"id":123,"name":"Charles Schwab","industry":"Financial Services","domain":"schwab.com","ticker":"SCHW",
     "ir_url":"https://investor.schwab.com","search_terms":["Charles Schwab investor day deck","SCHW earnings presentation"],"priority":"medium","notes":""},
    {"id":124,"name":"American Express","industry":"Financial Services","domain":"americanexpress.com","ticker":"AXP",
     "ir_url":"https://ir.americanexpress.com","search_terms":["American Express investor day deck","AXP earnings presentation"],"priority":"high","notes":""},
    {"id":125,"name":"Capital One","industry":"Financial Services","domain":"capitalone.com","ticker":"COF",
     "ir_url":"https://investor.capitalone.com","search_terms":["Capital One investor day deck","COF earnings presentation"],"priority":"medium","notes":""},
    {"id":126,"name":"Fiserv","industry":"Financial Services","domain":"fiserv.com","ticker":"FI",
     "ir_url":"https://investors.fiserv.com","search_terms":["Fiserv investor day deck","FI earnings presentation"],"priority":"medium","notes":""},
    {"id":127,"name":"Intercontinental Exchange","industry":"Financial Services","domain":"theice.com","ticker":"ICE",
     "ir_url":"https://ir.theice.com","search_terms":["ICE investor day presentation","Intercontinental Exchange earnings deck"],"priority":"medium","notes":""},
    {"id":128,"name":"Moody's Corporation","industry":"Financial Services","domain":"moodys.com","ticker":"MCO",
     "ir_url":"https://ir.moodys.com","search_terms":["Moodys investor day presentation","MCO earnings deck"],"priority":"medium","notes":""},
    {"id":129,"name":"S&P Global","industry":"Financial Services","domain":"spglobal.com","ticker":"SPGI",
     "ir_url":"https://investor.spglobal.com","search_terms":["S&P Global investor day deck","SPGI earnings presentation"],"priority":"medium","notes":""},
    {"id":130,"name":"Brookfield Asset Management","industry":"Financial Services","domain":"brookfield.com","ticker":"BAM",
     "ir_url":"https://bam.brookfield.com/investors","search_terms":["Brookfield investor day deck","BAM earnings presentation"],"priority":"medium","notes":""},

    # -------------------------------------------------------------------------
    # HEALTHCARE & PHARMA
    # -------------------------------------------------------------------------
    {"id":131,"name":"Johnson & Johnson","industry":"Healthcare","domain":"jnj.com","ticker":"JNJ",
     "ir_url":"https://investor.jnj.com","search_terms":["Johnson Johnson investor day presentation","JNJ earnings deck"],"priority":"high","notes":"Classic large-cap pharma deck style"},
    {"id":132,"name":"Pfizer","industry":"Healthcare","domain":"pfizer.com","ticker":"PFE",
     "ir_url":"https://investors.pfizer.com","search_terms":["Pfizer investor day presentation","PFE earnings deck"],"priority":"high","notes":""},
    {"id":133,"name":"Merck","industry":"Healthcare","domain":"merck.com","ticker":"MRK",
     "ir_url":"https://www.merck.com/investor-relations","search_terms":["Merck investor day presentation","MRK earnings deck"],"priority":"high","notes":""},
    {"id":134,"name":"Abbott Laboratories","industry":"Healthcare","domain":"abbott.com","ticker":"ABT",
     "ir_url":"https://investors.abbott.com","search_terms":["Abbott investor day deck","ABT earnings presentation"],"priority":"high","notes":""},
    {"id":135,"name":"UnitedHealth Group","industry":"Healthcare","domain":"unitedhealthgroup.com","ticker":"UNH",
     "ir_url":"https://www.unitedhealthgroup.com/investors","search_terms":["UnitedHealth investor day deck","UNH earnings presentation"],"priority":"high","notes":"One of the most data-heavy healthcare decks"},
    {"id":136,"name":"AbbVie","industry":"Healthcare","domain":"abbvie.com","ticker":"ABBV",
     "ir_url":"https://investors.abbvie.com","search_terms":["AbbVie investor day deck","ABBV earnings presentation"],"priority":"high","notes":""},
    {"id":137,"name":"Bristol-Myers Squibb","industry":"Healthcare","domain":"bms.com","ticker":"BMY",
     "ir_url":"https://investors.bms.com","search_terms":["Bristol-Myers Squibb investor day deck","BMY earnings presentation"],"priority":"medium","notes":""},
    {"id":138,"name":"Eli Lilly","industry":"Healthcare","domain":"lilly.com","ticker":"LLY",
     "ir_url":"https://investor.lilly.com","search_terms":["Eli Lilly investor day deck","LLY earnings presentation"],"priority":"high","notes":""},
    {"id":139,"name":"Amgen","industry":"Healthcare","domain":"amgen.com","ticker":"AMGN",
     "ir_url":"https://investors.amgen.com","search_terms":["Amgen investor day deck","AMGN earnings presentation"],"priority":"medium","notes":""},
    {"id":140,"name":"Medtronic","industry":"Healthcare","domain":"medtronic.com","ticker":"MDT",
     "ir_url":"https://investorrelations.medtronic.com","search_terms":["Medtronic investor day deck","MDT earnings presentation"],"priority":"medium","notes":""},
    {"id":141,"name":"Thermo Fisher Scientific","industry":"Healthcare","domain":"thermofisher.com","ticker":"TMO",
     "ir_url":"https://ir.thermofisher.com","search_terms":["Thermo Fisher investor day deck","TMO earnings presentation"],"priority":"medium","notes":""},
    {"id":142,"name":"Danaher","industry":"Healthcare","domain":"danaher.com","ticker":"DHR",
     "ir_url":"https://investors.danaher.com","search_terms":["Danaher investor day deck","DHR earnings presentation"],"priority":"medium","notes":""},
    {"id":143,"name":"CVS Health","industry":"Healthcare","domain":"cvshealth.com","ticker":"CVS",
     "ir_url":"https://investors.cvshealth.com","search_terms":["CVS Health investor day deck","CVS earnings presentation"],"priority":"high","notes":""},
    {"id":144,"name":"Elevance Health","industry":"Healthcare","domain":"elevancehealth.com","ticker":"ELV",
     "ir_url":"https://ir.elevancehealth.com","search_terms":["Elevance Health investor day deck","ELV Anthem earnings presentation"],"priority":"medium","notes":""},
    {"id":145,"name":"Humana","industry":"Healthcare","domain":"humana.com","ticker":"HUM",
     "ir_url":"https://investor.humana.com","search_terms":["Humana investor day deck","HUM earnings presentation"],"priority":"medium","notes":""},
    {"id":146,"name":"Moderna","industry":"Healthcare","domain":"modernatx.com","ticker":"MRNA",
     "ir_url":"https://investors.modernatx.com","search_terms":["Moderna investor day deck","MRNA earnings presentation"],"priority":"high","notes":"Heavy use of science diagrams — test complex graphic rendering"},

    # -------------------------------------------------------------------------
    # INDUSTRIALS
    # -------------------------------------------------------------------------
    {"id":147,"name":"General Electric","industry":"Industrials","domain":"ge.com","ticker":"GE",
     "ir_url":"https://www.ge.com/investor-relations","search_terms":["GE Aerospace investor day deck","General Electric earnings presentation"],"priority":"high","notes":"Recently split — Aerospace + Vernova both publish decks"},
    {"id":148,"name":"Honeywell","industry":"Industrials","domain":"honeywell.com","ticker":"HON",
     "ir_url":"https://investor.honeywell.com","search_terms":["Honeywell investor day deck","HON earnings presentation"],"priority":"high","notes":"Classic industrial conglomerate style"},
    {"id":149,"name":"3M","industry":"Industrials","domain":"3m.com","ticker":"MMM",
     "ir_url":"https://investors.3m.com","search_terms":["3M investor day deck","MMM earnings presentation"],"priority":"high","notes":""},
    {"id":150,"name":"Caterpillar","industry":"Industrials","domain":"caterpillar.com","ticker":"CAT",
     "ir_url":"https://investors.caterpillar.com","search_terms":["Caterpillar investor day deck","CAT earnings presentation"],"priority":"high","notes":"Yellow brand — test bold brand color rendering"},
    {"id":151,"name":"Deere & Company","industry":"Industrials","domain":"deere.com","ticker":"DE",
     "ir_url":"https://www.deere.com/en/our-company/investor-relations","search_terms":["John Deere investor day deck","DE earnings presentation"],"priority":"high","notes":""},
    {"id":152,"name":"Boeing","industry":"Industrials","domain":"boeing.com","ticker":"BA",
     "ir_url":"https://investors.boeing.com","search_terms":["Boeing investor day deck","BA earnings presentation"],"priority":"high","notes":"Aerospace corporate style — render-heavy with technical diagrams"},
    {"id":153,"name":"Lockheed Martin","industry":"Industrials","domain":"lockheedmartin.com","ticker":"LMT",
     "ir_url":"https://investor.lockheedmartin.com","search_terms":["Lockheed Martin investor day deck","LMT earnings presentation"],"priority":"high","notes":"Defense contractor standard template"},
    {"id":154,"name":"Raytheon Technologies (RTX)","industry":"Industrials","domain":"rtx.com","ticker":"RTX",
     "ir_url":"https://investors.rtx.com","search_terms":["RTX investor day deck","Raytheon earnings presentation"],"priority":"high","notes":""},
    {"id":155,"name":"Northrop Grumman","industry":"Industrials","domain":"northropgrumman.com","ticker":"NOC",
     "ir_url":"https://investor.northropgrumman.com","search_terms":["Northrop Grumman investor day deck","NOC earnings presentation"],"priority":"medium","notes":""},
    {"id":156,"name":"Emerson Electric","industry":"Industrials","domain":"emerson.com","ticker":"EMR",
     "ir_url":"https://investors.emerson.com","search_terms":["Emerson Electric investor day deck","EMR earnings presentation"],"priority":"medium","notes":""},
    {"id":157,"name":"Illinois Tool Works","industry":"Industrials","domain":"itw.com","ticker":"ITW",
     "ir_url":"https://investor.itw.com","search_terms":["Illinois Tool Works investor day deck","ITW earnings presentation"],"priority":"medium","notes":""},
    {"id":158,"name":"Parker Hannifin","industry":"Industrials","domain":"parker.com","ticker":"PH",
     "ir_url":"https://investor.parker.com","search_terms":["Parker Hannifin investor day deck","PH earnings presentation"],"priority":"medium","notes":""},
    {"id":159,"name":"Eaton Corporation","industry":"Industrials","domain":"eaton.com","ticker":"ETN",
     "ir_url":"https://investor.eaton.com","search_terms":["Eaton investor day deck","ETN earnings presentation"],"priority":"medium","notes":""},
    {"id":160,"name":"Carrier Global","industry":"Industrials","domain":"carrier.com","ticker":"CARR",
     "ir_url":"https://ir.carrier.com","search_terms":["Carrier Global investor day deck","CARR earnings presentation"],"priority":"medium","notes":""},
    {"id":161,"name":"Otis Worldwide","industry":"Industrials","domain":"otis.com","ticker":"OTIS",
     "ir_url":"https://ir.otis.com","search_terms":["Otis investor day deck","OTIS earnings presentation"],"priority":"medium","notes":""},

    # -------------------------------------------------------------------------
    # ENERGY
    # -------------------------------------------------------------------------
    {"id":162,"name":"ExxonMobil","industry":"Energy","domain":"exxonmobil.com","ticker":"XOM",
     "ir_url":"https://investor.exxonmobil.com","search_terms":["ExxonMobil investor day presentation","XOM earnings deck"],"priority":"high","notes":"One of the most standardized large-cap IR templates"},
    {"id":163,"name":"Chevron","industry":"Energy","domain":"chevron.com","ticker":"CVX",
     "ir_url":"https://www.chevron.com/investors","search_terms":["Chevron investor day presentation","CVX earnings deck"],"priority":"high","notes":""},
    {"id":164,"name":"ConocoPhillips","industry":"Energy","domain":"conocophillips.com","ticker":"COP",
     "ir_url":"https://investor.conocophillips.com","search_terms":["ConocoPhillips investor day deck","COP earnings presentation"],"priority":"high","notes":""},
    {"id":165,"name":"Shell","industry":"Energy","domain":"shell.com","ticker":"SHEL",
     "ir_url":"https://www.shell.com/investors","search_terms":["Shell investor day presentation","SHEL earnings deck"],"priority":"high","notes":"European corporate style — good non-US reference"},
    {"id":166,"name":"BP","industry":"Energy","domain":"bp.com","ticker":"BP",
     "ir_url":"https://www.bp.com/en/global/corporate/investors","search_terms":["BP investor day presentation","BP earnings deck"],"priority":"high","notes":""},
    {"id":167,"name":"NextEra Energy","industry":"Energy","domain":"nexteraenergy.com","ticker":"NEE",
     "ir_url":"https://investor.nexteraenergy.com","search_terms":["NextEra Energy investor day deck","NEE earnings presentation"],"priority":"high","notes":""},
    {"id":168,"name":"Duke Energy","industry":"Energy","domain":"duke-energy.com","ticker":"DUK",
     "ir_url":"https://investor.duke-energy.com","search_terms":["Duke Energy investor day deck","DUK earnings presentation"],"priority":"medium","notes":""},
    {"id":169,"name":"Southern Company","industry":"Energy","domain":"southerncompany.com","ticker":"SO",
     "ir_url":"https://investor.southerncompany.com","search_terms":["Southern Company investor day deck","SO earnings presentation"],"priority":"medium","notes":""},
    {"id":170,"name":"Enbridge","industry":"Energy","domain":"enbridge.com","ticker":"ENB",
     "ir_url":"https://investor.enbridge.com","search_terms":["Enbridge investor day deck","ENB earnings presentation"],"priority":"medium","notes":""},
    {"id":171,"name":"Kinder Morgan","industry":"Energy","domain":"kindermorgan.com","ticker":"KMI",
     "ir_url":"https://ir.kindermorgan.com","search_terms":["Kinder Morgan investor day deck","KMI earnings presentation"],"priority":"medium","notes":""},

    # -------------------------------------------------------------------------
    # CONSUMER / RETAIL
    # -------------------------------------------------------------------------
    {"id":172,"name":"Walmart","industry":"Consumer & Retail","domain":"walmart.com","ticker":"WMT",
     "ir_url":"https://stock.walmart.com","search_terms":["Walmart investor day presentation","WMT earnings deck"],"priority":"high","notes":"One of the most standardized large-cap retail templates"},
    {"id":173,"name":"Amazon","industry":"Consumer & Retail","domain":"amazon.com","ticker":"AMZN",
     "ir_url":"https://ir.aboutamazon.com","search_terms":["Amazon investor day presentation","AWS re:Invent keynote slides"],"priority":"high","notes":""},
    {"id":174,"name":"Home Depot","industry":"Consumer & Retail","domain":"homedepot.com","ticker":"HD",
     "ir_url":"https://ir.homedepot.com","search_terms":["Home Depot investor day deck","HD earnings presentation"],"priority":"high","notes":"Orange brand — test bold color systems"},
    {"id":175,"name":"Costco","industry":"Consumer & Retail","domain":"costco.com","ticker":"COST",
     "ir_url":"https://investor.costco.com","search_terms":["Costco investor day deck","COST earnings presentation"],"priority":"medium","notes":""},
    {"id":176,"name":"Target","industry":"Consumer & Retail","domain":"target.com","ticker":"TGT",
     "ir_url":"https://investors.target.com","search_terms":["Target investor day presentation","TGT earnings deck"],"priority":"high","notes":"Red brand — test primary color rendering"},
    {"id":177,"name":"Nike","industry":"Consumer & Retail","domain":"nike.com","ticker":"NKE",
     "ir_url":"https://investors.nike.com","search_terms":["Nike investor day presentation","NKE earnings deck"],"priority":"high","notes":"Strong brand identity — great for brand color testing"},
    {"id":178,"name":"Procter & Gamble","industry":"Consumer & Retail","domain":"pg.com","ticker":"PG",
     "ir_url":"https://pginvestor.com","search_terms":["Procter Gamble investor day presentation","PG earnings deck"],"priority":"high","notes":"Classic consumer staples deck — very standard formatting"},
    {"id":179,"name":"Coca-Cola","industry":"Consumer & Retail","domain":"coca-cola.com","ticker":"KO",
     "ir_url":"https://investors.coca-colacompany.com","search_terms":["Coca-Cola investor day presentation","KO earnings deck"],"priority":"high","notes":"Iconic red brand — test color fidelity"},
    {"id":180,"name":"PepsiCo","industry":"Consumer & Retail","domain":"pepsico.com","ticker":"PEP",
     "ir_url":"https://www.pepsico.com/investors","search_terms":["PepsiCo investor day presentation","PEP earnings deck"],"priority":"high","notes":""},
    {"id":181,"name":"McDonald's","industry":"Consumer & Retail","domain":"mcdonalds.com","ticker":"MCD",
     "ir_url":"https://corporate.mcdonalds.com/corpmcd/investors","search_terms":["McDonalds investor day deck","MCD earnings presentation"],"priority":"high","notes":"Yellow/red brand system"},
    {"id":182,"name":"Starbucks","industry":"Consumer & Retail","domain":"starbucks.com","ticker":"SBUX",
     "ir_url":"https://investor.starbucks.com","search_terms":["Starbucks investor day deck","SBUX earnings presentation"],"priority":"high","notes":"Green brand — strong visual identity"},
    {"id":183,"name":"Colgate-Palmolive","industry":"Consumer & Retail","domain":"colgatepalmolive.com","ticker":"CL",
     "ir_url":"https://investor.colgatepalmolive.com","search_terms":["Colgate investor day deck","CL earnings presentation"],"priority":"medium","notes":""},
    {"id":184,"name":"Mondelez International","industry":"Consumer & Retail","domain":"mondelezinternational.com","ticker":"MDLZ",
     "ir_url":"https://ir.mondelezinternational.com","search_terms":["Mondelez investor day deck","MDLZ earnings presentation"],"priority":"medium","notes":""},
    {"id":185,"name":"General Mills","industry":"Consumer & Retail","domain":"generalmills.com","ticker":"GIS",
     "ir_url":"https://investor.generalmills.com","search_terms":["General Mills investor day deck","GIS earnings presentation"],"priority":"medium","notes":""},

    # -------------------------------------------------------------------------
    # TELECOM & MEDIA
    # -------------------------------------------------------------------------
    {"id":186,"name":"AT&T","industry":"Telecom & Media","domain":"att.com","ticker":"T",
     "ir_url":"https://investors.att.com","search_terms":["AT&T investor day presentation","T earnings deck"],"priority":"high","notes":"Classic telecom template style"},
    {"id":187,"name":"Verizon","industry":"Telecom & Media","domain":"verizon.com","ticker":"VZ",
     "ir_url":"https://www.verizon.com/about/investors","search_terms":["Verizon investor day presentation","VZ earnings deck"],"priority":"high","notes":""},
    {"id":188,"name":"T-Mobile","industry":"Telecom & Media","domain":"t-mobile.com","ticker":"TMUS",
     "ir_url":"https://investor.t-mobile.com","search_terms":["T-Mobile investor day presentation","TMUS earnings deck"],"priority":"high","notes":"Magenta brand — test bright brand colors"},
    {"id":189,"name":"Comcast","industry":"Telecom & Media","domain":"comcast.com","ticker":"CMCSA",
     "ir_url":"https://corporate.comcast.com/investors","search_terms":["Comcast investor day deck","CMCSA earnings presentation"],"priority":"high","notes":""},
    {"id":190,"name":"Walt Disney","industry":"Telecom & Media","domain":"disney.com","ticker":"DIS",
     "ir_url":"https://thewaltdisneycompany.com/investor-relations","search_terms":["Walt Disney investor day presentation","DIS earnings deck"],"priority":"high","notes":"Iconic brand — Disney corporate decks are polished and image-heavy"},
    {"id":191,"name":"Warner Bros. Discovery","industry":"Telecom & Media","domain":"wbd.com","ticker":"WBD",
     "ir_url":"https://ir.wbd.com","search_terms":["Warner Bros Discovery investor day deck","WBD earnings presentation"],"priority":"medium","notes":""},
    {"id":192,"name":"Charter Communications","industry":"Telecom & Media","domain":"charter.com","ticker":"CHTR",
     "ir_url":"https://ir.charter.com","search_terms":["Charter Communications investor day deck","CHTR earnings presentation"],"priority":"medium","notes":""},
    {"id":193,"name":"Fox Corporation","industry":"Telecom & Media","domain":"foxcorporation.com","ticker":"FOX",
     "ir_url":"https://investor.foxcorporation.com","search_terms":["Fox Corp investor day deck","FOX earnings presentation"],"priority":"medium","notes":""},

    # -------------------------------------------------------------------------
    # CONSULTING & PROFESSIONAL SERVICES
    # -------------------------------------------------------------------------
    {"id":194,"name":"Accenture","industry":"Consulting","domain":"accenture.com","ticker":"ACN",
     "ir_url":"https://investor.accenture.com","search_terms":["Accenture investor day deck","ACN earnings presentation"],"priority":"high","notes":"Consulting decks = gold standard for corporate slide design"},
    {"id":195,"name":"Gartner","industry":"Consulting","domain":"gartner.com","ticker":"IT",
     "ir_url":"https://investor.gartner.com","search_terms":["Gartner investor day deck","Gartner Symposium conference slides"],"priority":"high","notes":"Famous for Magic Quadrant slides — unique chart style"},
    {"id":196,"name":"Booz Allen Hamilton","industry":"Consulting","domain":"boozallen.com","ticker":"BAH",
     "ir_url":"https://investors.boozallen.com","search_terms":["Booz Allen Hamilton investor day deck","BAH earnings presentation"],"priority":"medium","notes":""},
    {"id":197,"name":"SAIC","industry":"Consulting","domain":"saic.com","ticker":"SAIC",
     "ir_url":"https://investors.saic.com","search_terms":["SAIC investor day deck","SAIC earnings presentation"],"priority":"medium","notes":""},
    {"id":198,"name":"Leidos","industry":"Consulting","domain":"leidos.com","ticker":"LDOS",
     "ir_url":"https://ir.leidos.com","search_terms":["Leidos investor day deck","LDOS earnings presentation"],"priority":"medium","notes":""},
    {"id":199,"name":"ManTech International","industry":"Consulting","domain":"mantech.com","ticker":None,
     "ir_url":None,"search_terms":["ManTech corporate presentation deck","ManTech defense consulting slides"],"priority":"low","notes":"Private (acquired by Carlyle) — look for conference materials"},

    # -------------------------------------------------------------------------
    # REAL ESTATE & REITS
    # -------------------------------------------------------------------------
    {"id":200,"name":"Prologis","industry":"Real Estate","domain":"prologis.com","ticker":"PLD",
     "ir_url":"https://ir.prologis.com","search_terms":["Prologis investor day deck","PLD earnings presentation"],"priority":"high","notes":"Largest industrial REIT — clean modern design"},
    {"id":201,"name":"American Tower","industry":"Real Estate","domain":"americantower.com","ticker":"AMT",
     "ir_url":"https://ir.americantower.com","search_terms":["American Tower investor day deck","AMT earnings presentation"],"priority":"high","notes":""},
    {"id":202,"name":"Equinix","industry":"Real Estate","domain":"equinix.com","ticker":"EQIX",
     "ir_url":"https://investor.equinix.com","search_terms":["Equinix investor day deck","EQIX earnings presentation"],"priority":"high","notes":""},
    {"id":203,"name":"Crown Castle","industry":"Real Estate","domain":"crowncastle.com","ticker":"CCI",
     "ir_url":"https://investor.crowncastle.com","search_terms":["Crown Castle investor day deck","CCI earnings presentation"],"priority":"medium","notes":""},
    {"id":204,"name":"Simon Property Group","industry":"Real Estate","domain":"simon.com","ticker":"SPG",
     "ir_url":"https://investors.simon.com","search_terms":["Simon Property Group investor day deck","SPG earnings presentation"],"priority":"medium","notes":""},
    {"id":205,"name":"CBRE Group","industry":"Real Estate","domain":"cbre.com","ticker":"CBRE",
     "ir_url":"https://ir.cbre.com","search_terms":["CBRE investor day deck","CBRE earnings presentation"],"priority":"high","notes":"Largest commercial real estate firm — great corporate template"},
    {"id":206,"name":"Jones Lang LaSalle","industry":"Real Estate","domain":"jll.com","ticker":"JLL",
     "ir_url":"https://ir.jll.com","search_terms":["JLL investor day deck","Jones Lang LaSalle earnings presentation"],"priority":"medium","notes":""},

    # -------------------------------------------------------------------------
    # AUTOMOTIVE
    # -------------------------------------------------------------------------
    {"id":207,"name":"Ford Motor Company","industry":"Automotive","domain":"ford.com","ticker":"F",
     "ir_url":"https://shareholder.ford.com","search_terms":["Ford investor day presentation","Ford earnings deck"],"priority":"high","notes":"Blue Oval brand — Ford Pro / EV split makes for interesting deck structures"},
    {"id":208,"name":"General Motors","industry":"Automotive","domain":"gm.com","ticker":"GM",
     "ir_url":"https://investor.gm.com","search_terms":["General Motors investor day presentation","GM earnings deck"],"priority":"high","notes":""},
    {"id":209,"name":"Tesla","industry":"Automotive","domain":"tesla.com","ticker":"TSLA",
     "ir_url":"https://ir.tesla.com","search_terms":["Tesla investor day presentation","Tesla earnings deck"],"priority":"high","notes":"Minimalist dark-theme design — stark contrast to traditional corporate style"},
    {"id":210,"name":"Rivian","industry":"Automotive","domain":"rivian.com","ticker":"RIVN",
     "ir_url":"https://rivian.com/investors","search_terms":["Rivian investor day presentation","RIVN earnings deck"],"priority":"high","notes":"Modern EV startup aesthetic"},
    {"id":211,"name":"Stellantis","industry":"Automotive","domain":"stellantis.com","ticker":"STLA",
     "ir_url":"https://www.stellantis.com/en/investors","search_terms":["Stellantis investor day presentation","STLA earnings deck"],"priority":"medium","notes":"European automotive style"},

    # -------------------------------------------------------------------------
    # INSURANCE
    # -------------------------------------------------------------------------
    {"id":212,"name":"Berkshire Hathaway","industry":"Insurance","domain":"berkshirehathaway.com","ticker":"BRK.B",
     "ir_url":"https://www.berkshirehathaway.com/","search_terms":["Berkshire Hathaway annual meeting presentation","Berkshire shareholder meeting deck"],"priority":"high","notes":"Warren Buffett letters + simple no-frills presentation style"},
    {"id":213,"name":"MetLife","industry":"Insurance","domain":"metlife.com","ticker":"MET",
     "ir_url":"https://investor.metlife.com","search_terms":["MetLife investor day deck","MET earnings presentation"],"priority":"medium","notes":""},
    {"id":214,"name":"Prudential Financial","industry":"Insurance","domain":"prudential.com","ticker":"PRU",
     "ir_url":"https://investor.prudential.com","search_terms":["Prudential investor day deck","PRU earnings presentation"],"priority":"medium","notes":""},
    {"id":215,"name":"Allstate","industry":"Insurance","domain":"allstate.com","ticker":"ALL",
     "ir_url":"https://investor.allstate.com","search_terms":["Allstate investor day deck","ALL earnings presentation"],"priority":"medium","notes":""},
    {"id":216,"name":"Progressive","industry":"Insurance","domain":"progressive.com","ticker":"PGR",
     "ir_url":"https://investors.progressive.com","search_terms":["Progressive investor day deck","PGR earnings presentation"],"priority":"medium","notes":""},
    {"id":217,"name":"Travelers","industry":"Insurance","domain":"travelers.com","ticker":"TRV",
     "ir_url":"https://investor.travelers.com","search_terms":["Travelers investor day deck","TRV earnings presentation"],"priority":"medium","notes":""},
    {"id":218,"name":"Aflac","industry":"Insurance","domain":"aflac.com","ticker":"AFL",
     "ir_url":"https://investors.aflac.com","search_terms":["Aflac investor day deck","AFL earnings presentation"],"priority":"medium","notes":""},

    # -------------------------------------------------------------------------
    # ADDITIONAL HIGH-VALUE ENTERPRISE SAAS / CLOUD
    # -------------------------------------------------------------------------
    {"id":219,"name":"ServiceTitan","industry":"Enterprise SaaS","domain":"servicetitan.com","ticker":"TTAN",
     "ir_url":"https://investors.servicetitan.com","search_terms":["ServiceTitan investor day deck","TTAN earnings presentation"],"priority":"medium","notes":"Recent 2024 IPO — fresh modern deck design"},
    {"id":220,"name":"Klaviyo","industry":"Enterprise SaaS","domain":"klaviyo.com","ticker":"KVYO",
     "ir_url":"https://investors.klaviyo.com","search_terms":["Klaviyo investor day deck","KVYO earnings presentation"],"priority":"medium","notes":""},
    {"id":221,"name":"Rubrik","industry":"Enterprise SaaS","domain":"rubrik.com","ticker":"RBRK",
     "ir_url":"https://ir.rubrik.com","search_terms":["Rubrik investor day deck","RBRK earnings presentation"],"priority":"medium","notes":"Recent 2024 IPO"},
    {"id":222,"name":"Arm Holdings","industry":"Enterprise SaaS","domain":"arm.com","ticker":"ARM",
     "ir_url":"https://investor.arm.com","search_terms":["Arm Holdings investor day deck","ARM earnings presentation"],"priority":"high","notes":"Recent large IPO — very polished tech deck style"},
    {"id":223,"name":"Klaviyo","industry":"Enterprise SaaS","domain":"klaviyo.com","ticker":"KVYO",
     "ir_url":None,"search_terms":["Klaviyo investor presentation","Klaviyo marketing platform deck"],"priority":"low","notes":""},
    {"id":224,"name":"HashiCorp","industry":"Enterprise SaaS","domain":"hashicorp.com","ticker":None,
     "ir_url":None,"search_terms":["HashiCorp investor presentation deck","HashiCorp platform conference slides"],"priority":"medium","notes":"Acquired by IBM — look for pre-acquisition decks"},
    {"id":225,"name":"Confluent","industry":"Enterprise SaaS","domain":"confluent.io","ticker":"CFLT",
     "ir_url":"https://investors.confluent.io","search_terms":["Confluent investor day deck","CFLT earnings presentation"],"priority":"medium","notes":""},
    {"id":226,"name":"Amplitude","industry":"Enterprise SaaS","domain":"amplitude.com","ticker":"AMPL",
     "ir_url":"https://investors.amplitude.com","search_terms":["Amplitude investor day deck","AMPL earnings presentation"],"priority":"low","notes":""},
    {"id":227,"name":"Braze","industry":"Enterprise SaaS","domain":"braze.com","ticker":"BRZE",
     "ir_url":"https://investors.braze.com","search_terms":["Braze investor day deck","BRZE earnings presentation"],"priority":"medium","notes":""},
    {"id":228,"name":"Clearbit","industry":"Enterprise SaaS","domain":"clearbit.com","ticker":None,
     "ir_url":None,"search_terms":["Clearbit sales deck pptx","Clearbit data enrichment platform presentation"],"priority":"low","notes":"Private — look for sales/partner decks"},
    {"id":229,"name":"Loom","industry":"Enterprise SaaS","domain":"loom.com","ticker":None,
     "ir_url":None,"search_terms":["Loom video messaging deck pptx","Loom investor presentation"],"priority":"low","notes":"Acquired by Atlassian"},
    {"id":230,"name":"Notion","industry":"Enterprise SaaS","domain":"notion.so","ticker":None,
     "ir_url":None,"search_terms":["Notion workspace investor presentation","Notion platform deck pptx"],"priority":"medium","notes":"Private unicorn — minimal aesthetic great for contrast with traditional"},

    # -------------------------------------------------------------------------
    # ADDITIONAL FINANCIAL TECH / PAYMENTS
    # -------------------------------------------------------------------------
    {"id":231,"name":"Fidelity National Information Services (FIS)","industry":"Fintech","domain":"fisglobal.com","ticker":"FIS",
     "ir_url":"https://investors.fisglobal.com","search_terms":["FIS investor day deck","Fidelity National Information Services earnings"],"priority":"high","notes":""},
    {"id":232,"name":"Global Payments","industry":"Fintech","domain":"globalpayments.com","ticker":"GPN",
     "ir_url":"https://investors.globalpayments.com","search_terms":["Global Payments investor day deck","GPN earnings presentation"],"priority":"medium","notes":""},
    {"id":233,"name":"Jack Henry & Associates","industry":"Fintech","domain":"jackhenry.com","ticker":"JKHY",
     "ir_url":"https://investor.jackhenry.com","search_terms":["Jack Henry investor day deck","JKHY earnings presentation"],"priority":"medium","notes":""},
    {"id":234,"name":"Euronet Worldwide","industry":"Fintech","domain":"euronetworldwide.com","ticker":"EEFT",
     "ir_url":"https://ir.euronetworldwide.com","search_terms":["Euronet investor day deck","EEFT earnings presentation"],"priority":"low","notes":""},
    {"id":235,"name":"WEX Inc","industry":"Fintech","domain":"wexinc.com","ticker":"WEX",
     "ir_url":"https://ir.wexinc.com","search_terms":["WEX investor day deck","WEX earnings presentation"],"priority":"low","notes":""},

    # -------------------------------------------------------------------------
    # LOGISTICS & TRANSPORTATION
    # -------------------------------------------------------------------------
    {"id":236,"name":"FedEx","industry":"Logistics","domain":"fedex.com","ticker":"FDX",
     "ir_url":"https://investors.fedex.com","search_terms":["FedEx investor day presentation","FDX earnings deck"],"priority":"high","notes":"Purple brand — strong corporate identity"},
    {"id":237,"name":"UPS","industry":"Logistics","domain":"ups.com","ticker":"UPS",
     "ir_url":"https://ir.ups.com","search_terms":["UPS investor day presentation","UPS earnings deck"],"priority":"high","notes":"Brown brand — distinctive corporate style"},
    {"id":238,"name":"C.H. Robinson","industry":"Logistics","domain":"chrobinson.com","ticker":"CHRW",
     "ir_url":"https://investors.chrobinson.com","search_terms":["CH Robinson investor day deck","CHRW earnings presentation"],"priority":"medium","notes":""},
    {"id":239,"name":"Expeditors International","industry":"Logistics","domain":"expeditors.com","ticker":"EXPD",
     "ir_url":"https://investor.expeditors.com","search_terms":["Expeditors investor day deck","EXPD earnings presentation"],"priority":"low","notes":""},
    {"id":240,"name":"XPO Logistics","industry":"Logistics","domain":"xpo.com","ticker":"XPO",
     "ir_url":"https://investor.xpo.com","search_terms":["XPO investor day deck","XPO earnings presentation"],"priority":"medium","notes":""},

    # -------------------------------------------------------------------------
    # MATERIALS & CHEMICALS
    # -------------------------------------------------------------------------
    {"id":241,"name":"Dow Inc","industry":"Materials","domain":"dow.com","ticker":"DOW",
     "ir_url":"https://investor.dow.com","search_terms":["Dow investor day presentation","DOW earnings deck"],"priority":"high","notes":""},
    {"id":242,"name":"DuPont","industry":"Materials","domain":"dupont.com","ticker":"DD",
     "ir_url":"https://investors.dupont.com","search_terms":["DuPont investor day presentation","DD earnings deck"],"priority":"medium","notes":""},
    {"id":243,"name":"LyondellBasell","industry":"Materials","domain":"lyondellbasell.com","ticker":"LYB",
     "ir_url":"https://investor.lyondellbasell.com","search_terms":["LyondellBasell investor day deck","LYB earnings presentation"],"priority":"medium","notes":""},
    {"id":244,"name":"Air Products","industry":"Materials","domain":"airproducts.com","ticker":"APD",
     "ir_url":"https://investors.airproducts.com","search_terms":["Air Products investor day deck","APD earnings presentation"],"priority":"medium","notes":""},
    {"id":245,"name":"Linde","industry":"Materials","domain":"linde.com","ticker":"LIN",
     "ir_url":"https://www.linde.com/investors","search_terms":["Linde investor day deck","LIN earnings presentation"],"priority":"medium","notes":""},

    # -------------------------------------------------------------------------
    # AEROSPACE & DEFENSE ADDITIONAL
    # -------------------------------------------------------------------------
    {"id":246,"name":"L3Harris Technologies","industry":"Aerospace & Defense","domain":"l3harris.com","ticker":"LHX",
     "ir_url":"https://investors.l3harris.com","search_terms":["L3Harris investor day deck","LHX earnings presentation"],"priority":"medium","notes":""},
    {"id":247,"name":"Leidos Holdings","industry":"Aerospace & Defense","domain":"leidos.com","ticker":"LDOS",
     "ir_url":"https://ir.leidos.com","search_terms":["Leidos investor day deck","LDOS earnings presentation"],"priority":"medium","notes":""},
    {"id":248,"name":"BAE Systems","industry":"Aerospace & Defense","domain":"baesystems.com","ticker":"BAESY",
     "ir_url":"https://investors.baesystems.com","search_terms":["BAE Systems investor day deck","BAESY earnings presentation"],"priority":"medium","notes":"UK defense contractor — European corporate style"},

    # -------------------------------------------------------------------------
    # SEMICONDUCTOR / HARDWARE
    # -------------------------------------------------------------------------
    {"id":249,"name":"Advanced Micro Devices (AMD)","industry":"Semiconductors","domain":"amd.com","ticker":"AMD",
     "ir_url":"https://investor.amd.com","search_terms":["AMD investor day deck","AMD Financial Analyst Day presentation"],"priority":"high","notes":"Red brand — strong visual identity"},
    {"id":250,"name":"Micron Technology","industry":"Semiconductors","domain":"micron.com","ticker":"MU",
     "ir_url":"https://investors.micron.com","search_terms":["Micron Technology investor day deck","MU earnings presentation"],"priority":"high","notes":""},
    {"id":251,"name":"Applied Materials","industry":"Semiconductors","domain":"appliedmaterials.com","ticker":"AMAT",
     "ir_url":"https://investor.appliedmaterials.com","search_terms":["Applied Materials investor day deck","AMAT earnings presentation"],"priority":"medium","notes":""},
    {"id":252,"name":"ASML","industry":"Semiconductors","domain":"asml.com","ticker":"ASML",
     "ir_url":"https://www.asml.com/en/investors","search_terms":["ASML investor day deck","ASML earnings presentation"],"priority":"high","notes":"Dutch company — European corporate design style"},
    {"id":253,"name":"Marvell Technology","industry":"Semiconductors","domain":"marvell.com","ticker":"MRVL",
     "ir_url":"https://investor.marvell.com","search_terms":["Marvell Technology investor day deck","MRVL earnings presentation"],"priority":"medium","notes":""},
    {"id":254,"name":"Analog Devices","industry":"Semiconductors","domain":"analog.com","ticker":"ADI",
     "ir_url":"https://investor.analog.com","search_terms":["Analog Devices investor day deck","ADI earnings presentation"],"priority":"medium","notes":""},

    # -------------------------------------------------------------------------
    # CLOUD / INFRASTRUCTURE ADDITIONAL
    # -------------------------------------------------------------------------
    {"id":255,"name":"Cloudflare","industry":"Cloud & Infrastructure","domain":"cloudflare.com","ticker":"NET",
     "ir_url":"https://cloudflare.net/investors","search_terms":["Cloudflare investor day deck","NET earnings presentation"],"priority":"high","notes":"Already in list but adding backup entry"},
    {"id":256,"name":"Akamai Technologies","industry":"Cloud & Infrastructure","domain":"akamai.com","ticker":"AKAM",
     "ir_url":"https://ir.akamai.com","search_terms":["Akamai investor day deck","AKAM earnings presentation"],"priority":"medium","notes":""},
    {"id":257,"name":"Twilio","industry":"Cloud & Infrastructure","domain":"twilio.com","ticker":"TWLO",
     "ir_url":"https://investors.twilio.com","search_terms":["Twilio SIGNAL conference deck","Twilio investor presentation"],"priority":"medium","notes":""},
    {"id":258,"name":"F5 Networks","industry":"Cloud & Infrastructure","domain":"f5.com","ticker":"FFIV",
     "ir_url":"https://investors.f5.com","search_terms":["F5 Networks investor day deck","FFIV earnings presentation"],"priority":"low","notes":""},
    {"id":259,"name":"Juniper Networks","industry":"Cloud & Infrastructure","domain":"juniper.net","ticker":"JNPR",
     "ir_url":"https://investor.juniper.net","search_terms":["Juniper Networks investor day deck","JNPR earnings presentation"],"priority":"low","notes":""},

    # -------------------------------------------------------------------------
    # ADDITIONAL NOTABLE ENTERPRISES
    # -------------------------------------------------------------------------
    {"id":260,"name":"Salesforce (Tableau)","industry":"Enterprise SaaS","domain":"tableau.com","ticker":None,
     "ir_url":None,"search_terms":["Tableau conference presentation deck pptx","Tableau TC conference slides"],"priority":"medium","notes":"Data viz heavy — good test for complex chart styles"},
    {"id":261,"name":"Atlassian","industry":"Enterprise SaaS","domain":"atlassian.com","ticker":"TEAM",
     "ir_url":"https://investors.atlassian.com","search_terms":["Atlassian investor day deck","TEAM earnings presentation"],"priority":"high","notes":"Blue brand — Australian tech company, good non-US enterprise design"},
    {"id":262,"name":"Zendesk","industry":"Enterprise SaaS","domain":"zendesk.com","ticker":None,
     "ir_url":None,"search_terms":["Zendesk Relate conference deck pptx","Zendesk customer service platform presentation"],"priority":"medium","notes":"Went private 2022 — look for pre-acquisition decks"},
    {"id":263,"name":"New Relic","industry":"Enterprise SaaS","domain":"newrelic.com","ticker":None,
     "ir_url":None,"search_terms":["New Relic FutureStack conference deck pptx","New Relic investor presentation"],"priority":"medium","notes":"Went private 2023"},
    {"id":264,"name":"Dropbox","industry":"Enterprise SaaS","domain":"dropbox.com","ticker":"DBX",
     "ir_url":"https://investors.dropbox.com","search_terms":["Dropbox investor day deck","DBX earnings presentation"],"priority":"medium","notes":""},
    {"id":265,"name":"Box","industry":"Enterprise SaaS","domain":"box.com","ticker":"BOX",
     "ir_url":"https://investors.box.com","search_terms":["Box BoxWorks conference deck pptx","Box investor day presentation"],"priority":"medium","notes":""},
    {"id":266,"name":"DocuSign","industry":"Enterprise SaaS","domain":"docusign.com","ticker":"DOCU",
     "ir_url":"https://investor.docusign.com","search_terms":["DocuSign Momentum conference deck pptx","DocuSign investor day presentation"],"priority":"high","notes":"Blue brand — test gradient and subtle design elements"},
    {"id":267,"name":"Zoom Video","industry":"Enterprise SaaS","domain":"zoom.us","ticker":"ZM",
     "ir_url":"https://investors.zoom.us","search_terms":["Zoom investor day deck","ZM earnings presentation"],"priority":"high","notes":"Blue brand — gained huge visibility during COVID"},
    {"id":268,"name":"RingCentral","industry":"Enterprise SaaS","domain":"ringcentral.com","ticker":"RNG",
     "ir_url":"https://ir.ringcentral.com","search_terms":["RingCentral investor day deck","RNG earnings presentation"],"priority":"medium","notes":""},
    {"id":269,"name":"8x8","industry":"Enterprise SaaS","domain":"8x8.com","ticker":"EGHT",
     "ir_url":"https://investor.8x8.com","search_terms":["8x8 investor day deck","EGHT earnings presentation"],"priority":"low","notes":""},
    {"id":270,"name":"Five9","industry":"Enterprise SaaS","domain":"five9.com","ticker":"FIVN",
     "ir_url":"https://investors.five9.com","search_terms":["Five9 investor day deck","FIVN earnings presentation"],"priority":"low","notes":""},
    {"id":271,"name":"Lumentum","industry":"Semiconductors","domain":"lumentum.com","ticker":"LITE",
     "ir_url":"https://investor.lumentum.com","search_terms":["Lumentum investor day deck","LITE earnings presentation"],"priority":"low","notes":""},
    {"id":272,"name":"Cvent","industry":"Enterprise SaaS","domain":"cvent.com","ticker":None,
     "ir_url":None,"search_terms":["Cvent event management platform deck pptx","Cvent investor presentation"],"priority":"low","notes":"Went private 2023"},
    {"id":273,"name":"SS&C Technologies","industry":"Fintech","domain":"ssctech.com","ticker":"SSNC",
     "ir_url":"https://investor.ssctech.com","search_terms":["SS&C Technologies investor day deck","SSNC earnings presentation"],"priority":"medium","notes":""},
    {"id":274,"name":"Broadridge Financial","industry":"Fintech","domain":"broadridge.com","ticker":"BR",
     "ir_url":"https://ir.broadridge.com","search_terms":["Broadridge investor day deck","BR earnings presentation"],"priority":"medium","notes":""},
    {"id":275,"name":"Tyler Technologies","industry":"GovTech","domain":"tylertech.com","ticker":"TYL",
     "ir_url":"https://investors.tylertech.com","search_terms":["Tyler Technologies investor day deck","TYL earnings presentation"],"priority":"medium","notes":"Government software — good example of public sector corporate style"},
    {"id":276,"name":"Lowe's Companies","industry":"Consumer & Retail","domain":"lowes.com","ticker":"LOW",
     "ir_url":"https://investors.lowes.com","search_terms":["Lowe's investor day presentation","LOW earnings deck"],"priority":"high","notes":"Big-box retail with strong brand color usage"},
    {"id":277,"name":"Best Buy","industry":"Consumer & Retail","domain":"bestbuy.com","ticker":"BBY",
     "ir_url":"https://investors.bestbuy.com","search_terms":["Best Buy investor day deck","BBY earnings presentation"],"priority":"medium","notes":""},
    {"id":278,"name":"TJX Companies","industry":"Consumer & Retail","domain":"tjx.com","ticker":"TJX",
     "ir_url":"https://investor.tjx.com","search_terms":["TJX investor day deck","TJX earnings presentation"],"priority":"medium","notes":""},
    {"id":279,"name":"Ross Stores","industry":"Consumer & Retail","domain":"rossstores.com","ticker":"ROST",
     "ir_url":"https://investors.rossstores.com","search_terms":["Ross Stores investor day deck","ROST earnings presentation"],"priority":"low","notes":""},
    {"id":280,"name":"Ulta Beauty","industry":"Consumer & Retail","domain":"ulta.com","ticker":"ULTA",
     "ir_url":"https://investor.ulta.com","search_terms":["Ulta Beauty investor day deck","ULTA earnings presentation"],"priority":"medium","notes":"Colorful consumer brand with heavy product imagery"},
    {"id":281,"name":"Chipotle Mexican Grill","industry":"Consumer & Retail","domain":"chipotle.com","ticker":"CMG",
     "ir_url":"https://ir.chipotle.com","search_terms":["Chipotle investor day deck","CMG earnings presentation"],"priority":"high","notes":"Bold brand system and image-heavy presentation style"},
    {"id":282,"name":"Marriott International","industry":"Travel","domain":"marriott.com","ticker":"MAR",
     "ir_url":"https://www.marriott.com/investor-relations.mi","search_terms":["Marriott investor day presentation","MAR earnings deck"],"priority":"medium","notes":""},
    {"id":283,"name":"Hilton Worldwide","industry":"Travel","domain":"hilton.com","ticker":"HLT",
     "ir_url":"https://ir.hilton.com","search_terms":["Hilton investor day deck","HLT earnings presentation"],"priority":"medium","notes":""},
    {"id":284,"name":"Airbnb","industry":"Travel","domain":"airbnb.com","ticker":"ABNB",
     "ir_url":"https://investors.airbnb.com","search_terms":["Airbnb investor day presentation","ABNB earnings deck"],"priority":"high","notes":"Strong product design and photo-heavy storytelling"},
    {"id":285,"name":"Uber Technologies","industry":"Mobility","domain":"uber.com","ticker":"UBER",
     "ir_url":"https://investor.uber.com","search_terms":["Uber investor day presentation","UBER earnings deck"],"priority":"high","notes":"Modern brand system and broad global business lines"},
    {"id":286,"name":"Lyft","industry":"Mobility","domain":"lyft.com","ticker":"LYFT",
     "ir_url":"https://investor.lyft.com","search_terms":["Lyft investor day deck","LYFT earnings presentation"],"priority":"medium","notes":""},
    {"id":287,"name":"DoorDash","industry":"Marketplaces","domain":"doordash.com","ticker":"DASH",
     "ir_url":"https://ir.doordash.com","search_terms":["DoorDash investor day deck","DASH earnings presentation"],"priority":"high","notes":"Fast-moving consumer marketplace and product-led visuals"},
    {"id":288,"name":"Instacart","industry":"Marketplaces","domain":"instacart.com","ticker":"CART",
     "ir_url":"https://investors.instacart.com","search_terms":["Instacart investor day deck","CART earnings presentation"],"priority":"medium","notes":""},
    {"id":289,"name":"Expedia Group","industry":"Travel","domain":"expediagroup.com","ticker":"EXPE",
     "ir_url":"https://www.expediagroup.com/investors","search_terms":["Expedia investor day deck","EXPE earnings presentation"],"priority":"medium","notes":""},
    {"id":290,"name":"Booking Holdings","industry":"Travel","domain":"bookingholdings.com","ticker":"BKNG",
     "ir_url":"https://ir.bookingholdings.com","search_terms":["Booking Holdings investor day deck","BKNG earnings presentation"],"priority":"high","notes":""},
    {"id":291,"name":"Trip.com Group","industry":"Travel","domain":"trip.com","ticker":"TCOM",
     "ir_url":"https://investors.trip.com","search_terms":["Trip.com investor day deck","TCOM earnings presentation"],"priority":"medium","notes":"Global travel platform with international deck styles"},
    {"id":292,"name":"Sony Group","industry":"Consumer Electronics","domain":"sony.com","ticker":"SONY",
     "ir_url":"https://www.sony.com/en/SonyInfo/IR","search_terms":["Sony investor day presentation","SONY earnings deck"],"priority":"high","notes":"Japanese corporate style and rich media presentations"},
    {"id":293,"name":"Nintendo","industry":"Consumer Electronics","domain":"nintendo.com","ticker":"NTDOY",
     "ir_url":"https://www.nintendo.co.jp/ir/en","search_terms":["Nintendo investor presentation","Nintendo earnings deck"],"priority":"high","notes":"Extremely strong visual identity and character-driven content"},
    {"id":294,"name":"Samsung Electronics","industry":"Consumer Electronics","domain":"samsung.com","ticker":"SMSN",
     "ir_url":"https://www.samsung.com/global/ir","search_terms":["Samsung investor presentation","Samsung earnings deck"],"priority":"high","notes":"Large global electronics company with high-design presentations"},
    {"id":295,"name":"Tencent Holdings","industry":"Internet","domain":"tencent.com","ticker":"TCEHY",
     "ir_url":"https://www.tencent.com/en-us/investors.html","search_terms":["Tencent investor presentation","Tencent earnings deck"],"priority":"high","notes":"International corporate design and product ecosystem breadth"},
    {"id":296,"name":"Alibaba Group","industry":"Internet","domain":"alibaba.com","ticker":"BABA",
     "ir_url":"https://www.alibabagroup.com/en-US/ir","search_terms":["Alibaba investor presentation","BABA earnings deck"],"priority":"high","notes":""},
    {"id":297,"name":"Baidu","industry":"Internet","domain":"baidu.com","ticker":"BIDU",
     "ir_url":"https://ir.baidu.com","search_terms":["Baidu investor presentation","BIDU earnings deck"],"priority":"medium","notes":""},
    {"id":298,"name":"MercadoLibre","industry":"Internet","domain":"mercadolibre.com","ticker":"MELI",
     "ir_url":"https://investor.mercadolibre.com","search_terms":["MercadoLibre investor day deck","MELI earnings presentation"],"priority":"high","notes":"Latin American scale company with strong product storytelling"},
    {"id":299,"name":"Sea Limited","industry":"Internet","domain":"sea.com","ticker":"SE",
     "ir_url":"https://www.sea.com/investor/home","search_terms":["Sea Limited investor presentation","SE earnings deck"],"priority":"medium","notes":""},
    {"id":300,"name":"Wolters Kluwer","industry":"Information Services","domain":"wolterskluwer.com","ticker":"WKL",
     "ir_url":"https://www.wolterskluwer.com/en/investors","search_terms":["Wolters Kluwer investor presentation","WKL earnings deck"],"priority":"medium","notes":"European B2B information products with polished decks"},
    {"id":301,"name":"Siemens","industry":"Industrials","domain":"siemens.com","ticker":"SIEGY",
     "ir_url":"https://www.siemens.com/global/en/company/investor-relations.html","search_terms":["Siemens investor presentation","Siemens capital markets day deck"],"priority":"high","notes":"Major European industrial design benchmark"},
    {"id":302,"name":"Schneider Electric","industry":"Industrials","domain":"se.com","ticker":"SBGSY",
     "ir_url":"https://www.se.com/ww/en/about-us/investor-relations","search_terms":["Schneider Electric investor presentation","Schneider Electric capital market day"],"priority":"high","notes":"Green brand and strong enterprise layout language"},
    {"id":303,"name":"ABB","industry":"Industrials","domain":"abb.com","ticker":"ABBNY",
     "ir_url":"https://global.abb/group/en/investors","search_terms":["ABB investor presentation","ABB capital markets day deck"],"priority":"medium","notes":""},
    {"id":304,"name":"Nokia","industry":"Telecom & Media","domain":"nokia.com","ticker":"NOK",
     "ir_url":"https://www.nokia.com/about-us/investors","search_terms":["Nokia investor presentation","NOK earnings deck"],"priority":"medium","notes":""},
    {"id":305,"name":"Ericsson","industry":"Telecom & Media","domain":"ericsson.com","ticker":"ERIC",
     "ir_url":"https://www.ericsson.com/en/investors","search_terms":["Ericsson investor presentation","ERIC earnings deck"],"priority":"medium","notes":""},
    {"id":306,"name":"Vodafone","industry":"Telecom & Media","domain":"vodafone.com","ticker":"VOD",
     "ir_url":"https://www.vodafone.com/investors","search_terms":["Vodafone investor presentation","VOD earnings deck"],"priority":"medium","notes":"UK telecom with very standardized corporate docs"},
    {"id":307,"name":"Orange S.A.","industry":"Telecom & Media","domain":"orange.com","ticker":"ORANY",
     "ir_url":"https://www.orange.com/en/group/finance/investors","search_terms":["Orange investor presentation","Orange capital markets day deck"],"priority":"medium","notes":""},
    {"id":308,"name":"Deutsche Telekom","industry":"Telecom & Media","domain":"telekom.com","ticker":"DTEGY",
     "ir_url":"https://www.telekom.com/en/investor-relations","search_terms":["Deutsche Telekom investor presentation","Deutsche Telekom capital markets day"],"priority":"medium","notes":"Magenta brand is useful for color fidelity tests"},
    {"id":309,"name":"Fidelity National Information Services","industry":"Fintech","domain":"fisglobal.com","ticker":"FIS",
     "ir_url":"https://investors.fisglobal.com","search_terms":["FIS investor day deck","FIS earnings presentation"],"priority":"medium","notes":""},
    {"id":310,"name":"Global Payments","industry":"Fintech","domain":"globalpayments.com","ticker":"GPN",
     "ir_url":"https://investors.globalpayments.com","search_terms":["Global Payments investor day deck","GPN earnings presentation"],"priority":"medium","notes":""},
    {"id":311,"name":"Visa","industry":"Fintech","domain":"visa.com","ticker":"V",
     "ir_url":"https://investor.visa.com","search_terms":["Visa investor day presentation","V earnings deck"],"priority":"high","notes":"Extremely polished corporate brand and common investor decks"},
    {"id":312,"name":"Mastercard","industry":"Fintech","domain":"mastercard.com","ticker":"MA",
     "ir_url":"https://investors.mastercard.com","search_terms":["Mastercard investor day presentation","MA earnings deck"],"priority":"high","notes":""},
    {"id":313,"name":"American Express Global Business Travel","industry":"Travel Services","domain":"amexglobalbusinesstravel.com","ticker":"GBTG",
     "ir_url":"https://investors.amexglobalbusinesstravel.com","search_terms":["Amex GBT investor presentation","GBTG earnings deck"],"priority":"low","notes":""},
    {"id":314,"name":"Elastic","industry":"Enterprise SaaS","domain":"elastic.co","ticker":"ESTC",
     "ir_url":"https://ir.elastic.co","search_terms":["Elastic investor day deck","ESTC earnings presentation"],"priority":"high","notes":"Strong brand colors and complex technical content"},
    {"id":315,"name":"GitLab","industry":"Enterprise SaaS","domain":"gitlab.com","ticker":"GTLB",
     "ir_url":"https://ir.gitlab.com","search_terms":["GitLab investor day deck","GTLB earnings presentation"],"priority":"high","notes":"Developer tooling decks often have dense diagrams"},
    {"id":316,"name":"PagerDuty","industry":"Enterprise SaaS","domain":"pagerduty.com","ticker":"PD",
     "ir_url":"https://investor.pagerduty.com","search_terms":["PagerDuty investor day deck","PD earnings presentation"],"priority":"medium","notes":""},
    {"id":317,"name":"CyberArk","industry":"Cybersecurity","domain":"cyberark.com","ticker":"CYBR",
     "ir_url":"https://investors.cyberark.com","search_terms":["CyberArk investor day deck","CYBR earnings presentation"],"priority":"medium","notes":""},
    {"id":318,"name":"JFrog","industry":"Enterprise SaaS","domain":"jfrog.com","ticker":"FROG",
     "ir_url":"https://investors.jfrog.com","search_terms":["JFrog investor day deck","FROG earnings presentation"],"priority":"medium","notes":""},
    {"id":319,"name":"Workiva","industry":"Enterprise SaaS","domain":"workiva.com","ticker":"WK",
     "ir_url":"https://investors.workiva.com","search_terms":["Workiva investor day deck","WK earnings presentation"],"priority":"medium","notes":""},
    {"id":320,"name":"Smartsheet","industry":"Enterprise SaaS","domain":"smartsheet.com","ticker":"SMAR",
     "ir_url":"https://investors.smartsheet.com","search_terms":["Smartsheet investor day deck","SMAR earnings presentation"],"priority":"medium","notes":""},
]

def main():
    with open(META, encoding="utf-8") as f:
        meta = json.load(f)

    existing_ids = {c["id"] for c in meta["target_companies"]}
    existing_names = {c["name"].lower() for c in meta["target_companies"]}

    added = 0
    skipped = 0
    for co in NEW_COMPANIES:
        if co["id"] in existing_ids:
            skipped += 1
            continue
        if co["name"].lower() in existing_names:
            skipped += 1
            continue
        meta["target_companies"].append(co)
        existing_ids.add(co["id"])
        existing_names.add(co["name"].lower())
        added += 1

    with open(META, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    print(f"Added {added} companies. Skipped {skipped} duplicates.")
    print(f"Total companies now: {len(meta['target_companies'])}")

if __name__ == "__main__":
    main()
