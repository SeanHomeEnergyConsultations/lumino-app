PRIORITY = {
    4: {"label": "PREMIUM", "color": "#C9A84C", "bg": "#2A1F00", "text": "#F0C060", "border": "#C9A84C", "dot": "#C9A84C"},
    3: {"label": "HIGHEST", "color": "#2E7D32", "bg": "#0A2010", "text": "#66BB6A", "border": "#2E7D32", "dot": "#43A047"},
    2: {"label": "HIGH", "color": "#00695C", "bg": "#071A17", "text": "#4DB6AC", "border": "#00897B", "dot": "#26A69A"},
    1: {"label": "MEDIUM", "color": "#BF5A00", "bg": "#1D1100", "text": "#FFB74D", "border": "#E67E22", "dot": "#E67E22"},
    0: {"label": "LOW", "color": "#424242", "bg": "#111111", "text": "#757575", "border": "#424242", "dot": "#616161"},
}

DEFAULT_PRIORITY = PRIORITY[0]


def get_priority_meta(score):
    return PRIORITY.get(score, DEFAULT_PRIORITY)
