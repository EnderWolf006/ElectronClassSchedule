const _settings = {
    "rotation_offset": {
        "2": 0,
        "3": 0,
        "4": 1
    },
    "custom_text": "祝老师教师节快乐",
    "reminder_color": "#114514",
    "component_layout": [
        [
            {
                "id": "date-1789104872317-9mnvj",
                "type": "date",
                "options": {}
            },
            {
                "id": "schedule-1",
                "type": "schedule",
                "options": {}
            },
            {
                "id": "countdown-1789104879309-ypmj9",
                "type": "countdown",
                "options": {
                    "mode": "date",
                    "target": "2027-06-07"
                }
            }
        ]
    ],
    "css_style": {
        "--center-font-size": "45px",
        "--corner-font-size": "14px",
        "--countdown-font-size": "25px",
        "--global-border-radius": "10px",
        "--global-bg-opacity": "0.5",
        "--container-bg-padding": "8px 14px",
        "--countdown-bg-padding": "5px 12px",
        "--container-space": "10px",
        "--top-space": "15px",
        "--main-horizontal-space": "8px",
        "--divider-width": "2px",
        "--divider-margin": "6px",
        "--triangle-size": "16px",
        "--sub-font-size": "15px"
    }
}

var settings = JSON.parse(JSON.stringify(_settings))
