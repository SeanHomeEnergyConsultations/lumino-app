import urllib.parse
from collections import defaultdict
from datetime import datetime

import pandas as pd

from engine.constants import PRIORITY, get_priority_meta


def build_zip_summary(all_results):
    zips = defaultdict(lambda: {"count": 0, "high": 0, "sun_hours": [], "doors": 0, "prices": []})
    for result in all_results:
        zipcode = result["zipcode"]
        zips[zipcode]["count"] += 1
        if result["priority_score"] >= 2:
            zips[zipcode]["high"] += 1
        if result["sun_hours"]:
            zips[zipcode]["sun_hours"].append(result["sun_hours"])
        if result["sale_price"]:
            zips[zipcode]["prices"].append(result["sale_price"])
        zips[zipcode]["doors"] += result["doors_to_knock"]

    summary = []
    for zipcode, data in zips.items():
        avg_sun = sum(data["sun_hours"]) / len(data["sun_hours"]) if data["sun_hours"] else 0
        avg_price = sum(data["prices"]) / len(data["prices"]) if data["prices"] else 0
        zip_score = (data["high"] * 2) + (avg_sun / 500) + (data["doors"] * 0.5) + (avg_price / 250000)
        summary.append(
            {
                "zipcode": zipcode,
                "total": data["count"],
                "high_priority": data["high"],
                "avg_sun_hours": round(avg_sun),
                "total_doors": data["doors"],
                "avg_home_value": f"${avg_price:,.0f}" if avg_price else "N/A",
                "zip_score": round(zip_score, 1),
            }
        )
    return sorted(summary, key=lambda x: x["zip_score"], reverse=True)


def priority_badge_html(score):
    priority = get_priority_meta(score)
    return (
        f'<span style="background:{priority["bg"]};color:{priority["text"]};border:1px solid {priority["border"]};'
        f'padding:4px 14px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:1.5px;'
        f'text-transform:uppercase;box-shadow:0 2px 6px rgba(0,0,0,0.4);">{priority["label"]}</span>'
    )


def generate_html_report(all_results):
    zip_summary = build_zip_summary(all_results)
    zip_rank = {item["zipcode"]: i for i, item in enumerate(zip_summary)}
    results = sorted(
        all_results,
        key=lambda x: (zip_rank.get(x["zipcode"], 99), -x["priority_score"], -x["doors_to_knock"]),
    )
    total = len(results)
    high_count = sum(1 for result in results if result["priority_score"] >= 2)
    medium_count = sum(1 for result in results if result["priority_score"] == 1)
    total_knocks = sum(result["doors_to_knock"] for result in results)

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Lumino Report</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box;}}
body{{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#060A14;color:#C0CAD8;padding:28px;}}
.container{{max-width:1040px;margin:0 auto;}}
.header{{padding:36px 0 28px;border-bottom:1px solid #141E30;margin-bottom:36px;}}
.header-logo{{font-size:2.2rem;font-weight:900;color:#C9A84C;letter-spacing:-1px;
              text-shadow:0 0 40px rgba(201,168,76,0.5);}}
.header-tagline{{font-size:11px;color:#2A3A50;letter-spacing:4px;text-transform:uppercase;margin-top:5px;}}
.gold-line{{height:2px;background:linear-gradient(90deg,#C9A84C,rgba(201,168,76,0.3),transparent);
            margin-top:10px;border-radius:2px;width:260px;box-shadow:0 0 10px rgba(201,168,76,0.3);}}
.header-meta{{font-size:12px;color:#2A3A50;margin-top:14px;}}
.stats{{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:36px;}}
.stat-card{{background:linear-gradient(145deg,#0D1220,#080C18);border:1px solid #141E30;
            border-radius:12px;padding:22px;text-align:center;
            box-shadow:5px 5px 15px rgba(0,0,0,0.6),-1px -1px 5px rgba(255,255,255,0.02);}}
.stat-number{{font-size:2.2rem;font-weight:900;color:#C9A84C;
              text-shadow:0 0 20px rgba(201,168,76,0.35);}}
.stat-label{{font-size:10px;color:#2A3A50;text-transform:uppercase;letter-spacing:1.5px;margin-top:8px;}}
.section-header{{border-left:3px solid #C9A84C;padding:10px 18px;margin:32px 0 18px;
                 background:linear-gradient(90deg,#0C1528,transparent);
                 font-size:10px;font-weight:700;color:#C9A84C;
                 letter-spacing:2.5px;text-transform:uppercase;border-radius:0 6px 6px 0;
                 box-shadow:inset 0 0 20px rgba(0,0,0,0.2);}}
.zip-table{{width:100%;border-collapse:collapse;margin-bottom:36px;
            border-radius:10px;overflow:hidden;border:1px solid #141E30;
            box-shadow:4px 4px 16px rgba(0,0,0,0.5);}}
.zip-table th{{background:#0A0E18;color:#4A5A70;padding:11px 16px;text-align:left;
               font-size:10px;text-transform:uppercase;letter-spacing:1.5px;border-bottom:1px solid #141E30;}}
.zip-table td{{padding:12px 16px;border-bottom:1px solid #0D1220;font-size:13px;color:#C0CAD8;}}
.zip-table tr:last-child td{{border-bottom:none;}}
.zip-table tr:hover td{{background:#0A0E18;}}
.score-cell{{color:#C9A84C;font-weight:800;text-shadow:0 0 10px rgba(201,168,76,0.3);}}
.card{{background:linear-gradient(145deg,#0D1220,#090D19);border:1px solid #141E30;
       border-radius:12px;margin-bottom:18px;padding:22px;
       box-shadow:5px 5px 18px rgba(0,0,0,0.6),-1px -1px 4px rgba(255,255,255,0.02);}}
.card-priority-4{{border-left:4px solid #C9A84C;box-shadow:5px 5px 18px rgba(0,0,0,0.6),-4px 0 12px rgba(201,168,76,0.15);}}
.card-priority-3{{border-left:4px solid #2E7D32;box-shadow:5px 5px 18px rgba(0,0,0,0.6),-4px 0 12px rgba(46,125,50,0.15);}}
.card-priority-2{{border-left:4px solid #558B2F;box-shadow:5px 5px 18px rgba(0,0,0,0.6),-4px 0 10px rgba(85,139,47,0.12);}}
.card-priority-1{{border-left:4px solid #E65100;box-shadow:5px 5px 18px rgba(0,0,0,0.6),-4px 0 10px rgba(230,81,0,0.1);}}
.card-priority-0{{border-left:4px solid #2A2A2A;opacity:0.55;}}
.card-header{{display:flex;align-items:center;gap:14px;margin-bottom:16px;}}
.card-address{{font-size:15px;font-weight:700;color:#E0E8F4;}}
.home-strip{{background:#060A14;border:1px solid #0D1420;border-radius:8px;
             padding:13px 18px;margin:14px 0;display:flex;gap:28px;flex-wrap:wrap;
             box-shadow:inset 0 1px 4px rgba(0,0,0,0.4);}}
.home-detail-label{{font-size:10px;color:#2A3A50;text-transform:uppercase;letter-spacing:1px;}}
.home-detail-value{{font-size:13px;font-weight:700;color:#C0CAD8;margin-top:4px;}}
.info-row{{display:flex;align-items:baseline;gap:10px;margin:7px 0;font-size:13px;}}
.info-label{{color:#2A3A50;min-width:110px;font-size:10px;text-transform:uppercase;letter-spacing:0.8px;}}
.info-value{{color:#C0CAD8;}}
.tag{{display:inline-block;padding:3px 10px;border-radius:4px;font-size:11px;
      font-weight:600;letter-spacing:0.5px;margin-left:8px;}}
.tag-solar-ideal   {{background:#061A0A;color:#66BB6A;border:1px solid #1B5E20;}}
.tag-solar-good    {{background:#061A0A;color:#81C784;border:1px solid #2E7D32;}}
.tag-solar-marginal{{background:#1A1000;color:#FFA726;border:1px solid #E65100;}}
.tag-solar-poor    {{background:#1A0606;color:#EF5350;border:1px solid #B71C1C;}}
.tag-value-high    {{background:#150E00;color:#C9A84C;border:1px solid #7A5C00;}}
.tag-value-mid     {{background:#060E1A;color:#64B5F6;border:1px solid #0D47A1;}}
.tag-size          {{background:#100618;color:#CE93D8;border:1px solid #4A148C;}}
.knock-list{{background:#060A14;border:1px solid #0D1420;border-radius:8px;
             padding:14px 18px;margin-top:12px;font-size:12px;
             box-shadow:inset 0 1px 4px rgba(0,0,0,0.4);}}
.knock-list-title{{color:#C9A84C;font-size:10px;text-transform:uppercase;
                   letter-spacing:1.5px;font-weight:700;margin-bottom:10px;}}
.knock-item{{color:#8A95AA;padding:4px 0;border-bottom:1px solid #0D1420;}}
.knock-item:last-child{{border-bottom:none;}}
.btn-group{{display:flex;gap:12px;margin-top:18px;flex-wrap:wrap;}}
.btn{{display:inline-block;padding:9px 20px;text-decoration:none;border-radius:6px;
      font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;
      box-shadow:0 2px 8px rgba(0,0,0,0.4);}}
.btn-sv {{background:transparent;color:#C9A84C;border:1px solid #7A5C00;}}
.btn-sv:hover {{background:#150E00;}}
.btn-dir{{background:transparent;color:#64B5F6;border:1px solid #0D47A1;}}
.btn-dir:hover {{background:#060E1A;}}
.footer{{margin-top:48px;padding-top:24px;border-top:1px solid #141E30;
         text-align:center;color:#1A2A40;font-size:10px;letter-spacing:2px;
         text-transform:uppercase;padding-bottom:48px;}}
</style>
</head>
<body>
<div class="container">
<div class="header">
    <div class="header-logo">Lumino</div>
    <div class="header-tagline">Field Performance Platform</div>
    <div class="gold-line"></div>
    <div class="header-meta">Report generated {datetime.now().strftime("%B %d, %Y at %I:%M %p")}</div>
</div>
<div class="stats">
    <div class="stat-card"><div class="stat-number">{total}</div><div class="stat-label">Properties Analyzed</div></div>
    <div class="stat-card"><div class="stat-number">{high_count}</div><div class="stat-label">High Priority</div></div>
    <div class="stat-card"><div class="stat-number">{medium_count}</div><div class="stat-label">Medium Priority</div></div>
    <div class="stat-card"><div class="stat-number">{total_knocks}</div><div class="stat-label">Doors to Knock</div></div>
</div>
<div class="section-header">Area Intelligence — Zip Code Ranking</div>
<table class="zip-table">
<tr><th>Zip</th><th>Properties</th><th>High Priority</th><th>Avg Sun Hrs</th><th>Avg Home Value</th><th>Total Doors</th><th>Area Score</th></tr>
"""
    for zipcode in zip_summary:
        html += (
            f'<tr><td><strong>{zipcode["zipcode"]}</strong></td><td>{zipcode["total"]}</td>'
            f'<td>{zipcode["high_priority"]}</td><td>{zipcode["avg_sun_hours"]}</td>'
            f'<td>{zipcode["avg_home_value"]}</td><td>{zipcode["total_doors"]}</td>'
            f'<td class="score-cell">{zipcode["zip_score"]}</td></tr>\n'
        )
    html += "</table>\n"

    current_zip = None
    for result in results:
        if result["zipcode"] != current_zip:
            current_zip = result["zipcode"]
            z_data = next((item for item in zip_summary if item["zipcode"] == current_zip), {})
            html += (
                f'<div class="section-header">Zip {current_zip} &nbsp;·&nbsp; Score {z_data.get("zip_score", "?")} '
                f'&nbsp;·&nbsp; {z_data.get("high_priority", "?")} High Priority &nbsp;·&nbsp; '
                f'Avg {z_data.get("avg_home_value", "N/A")}</div>\n'
            )

        priority_score = result["priority_score"]
        sun_text = f'{result["sun_hours_display"]} hrs' if result["sun_hours"] else "N/A"
        park_short = (
            result["parking_address"][:70] + "..."
            if len(result["parking_address"]) > 70
            else result["parking_address"]
        )
        solar_tag_class = {
            "Best": "tag-solar-ideal",
            "Better": "tag-solar-good",
            "Good": "tag-solar-good",
            "Low": "tag-solar-marginal",
            "Too Low": "tag-solar-poor",
        }.get(result["category"], "tag-solar-poor")
        value_tag_class = "tag-value-high" if result.get("value_score", 0) >= 2 else "tag-value-mid"
        size_label = "Large" if (result["sqft"] or 0) >= 3000 else "Mid-Size" if (result["sqft"] or 0) >= 2000 else "Compact"

        html += (
            f'<div class="card card-priority-{priority_score}">\n'
            f'<div class="card-header">{priority_badge_html(priority_score)}<span class="card-address">{result["address"]}</span></div>\n'
            '<div class="home-strip">\n'
            f'    <div><div class="home-detail-label">Sale Price</div><div class="home-detail-value">{result["price_display"]}</div></div>\n'
            f'    <div><div class="home-detail-label">Size</div><div class="home-detail-value">{result["sqft_display"]}</div></div>\n'
            f'    <div><div class="home-detail-label">Beds / Baths</div><div class="home-detail-value">{result.get("beds", "?")} bd / {result.get("baths", "?")} ba</div></div>\n'
            f'    <div><div class="home-detail-label">Sold</div><div class="home-detail-value">{result["sold_date"]}</div></div>\n'
            '</div>\n'
            f'<div class="info-row"><span class="info-label">Solar</span><span class="info-value">{sun_text}<span class="tag {solar_tag_class}">{result["category"]}</span></span></div>\n'
            f'<div class="info-row"><span class="info-label">Home Value</span><span class="info-value">{result["price_display"]}<span class="tag {value_tag_class}">{result["value_badge"]}</span></span></div>\n'
            f'<div class="info-row"><span class="info-label">Size</span><span class="info-value">{result["sqft_display"]}<span class="tag tag-size">{size_label}</span></span></div>\n'
            f'<div class="info-row"><span class="info-label">Park At</span><span class="info-value">{park_short}</span></div>\n'
            f'<div class="info-row"><span class="info-label">Knock</span><span class="info-value">{result["doors_to_knock"]} doors ({result["ideal_count"]} ideal, {result["good_count"]} good)</span></div>\n'
            f'<div class="info-row"><span class="info-label">Parking</span><span class="info-value">{result["parking_ease"]}</span></div>\n'
        )

        if result["knock_addresses"]:
            html += '<div class="knock-list"><div class="knock-list-title">Addresses to Knock</div>'
            for address in result["knock_addresses"]:
                html += f'<div class="knock-item">{address}</div>'
            html += "</div>"

        html += (
            '<div class="btn-group">\n'
            f'    <a href="{result["street_view_link"]}" target="_blank" class="btn btn-sv">Street View</a>\n'
            f'    <a href="https://www.google.com/maps/search/?api=1&query={urllib.parse.quote(result["parking_address"])}" target="_blank" class="btn btn-dir">Get Directions</a>\n'
            "</div></div>\n"
        )

    html += (
        f'<div class="footer">Lumino &nbsp;·&nbsp; Field Performance Platform &nbsp;·&nbsp; '
        f'{datetime.now().strftime("%Y")}</div></div></body></html>'
    )
    return html


def build_route_csv(selected_results):
    rows = []
    for result in selected_results:
        addresses = result["knock_addresses"] if result["knock_addresses"] else [result["address"]]
        for address in addresses:
            rows.append(
                {
                    "address": address,
                    "priority": get_priority_meta(result["priority_score"])["label"],
                    "sale_price": result["price_display"],
                    "sqft": result["sqft_display"],
                    "sold_date": result["sold_date"],
                    "sun_hours": result["sun_hours_display"],
                    "solar_category": result["category"],
                    "doors_in_cluster": result["doors_to_knock"],
                    "zipcode": result["zipcode"],
                }
            )
    return pd.DataFrame(rows).to_csv(index=False)
