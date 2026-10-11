const _settings = {
    "rotation_offset": {
        "2": 0,
        "3": 0,
        "4": 0
    },
    "semester_start_date": "",
    "semester_start_week": 1,
    "rotation_mode": "timetable",
    "multi_rotation_entries": [],
    "custom_text": "请输入文本",
    "reminder_color": "#114514",
    "reminder_class": {
        "upcoming_enabled": false,
        "start_enabled": true,
        "end_enabled": false,
        "upcoming_seconds": 300,
        "upcoming_text": "即将上课",
        "start_text": "上课",
        "end_text": "下课"
    },
    "reminder_custom": [],
    "reminder_enabled": true,
    "reminder_weather": {
        "enabled": false,
        "time": "07:00",
        "city": "",
        "extreme_enabled": false,
        "quake_enabled": false
    },
    "reminder_advanced": {
        "sound_enabled": true,
        "sound_source": "builtin",
        "sound_file": "",
        "ontop_enabled": false,
        "fullscreen_enabled": true
    },
    "theme_mode": "dark",
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
            },
            {
                "id": "weather-1790774034149-89eik",
                "type": "weather",
                "options": {
                    "city": ""
                }
            }
        ]
    ],
    "css_style": {
        "--center-font-size": "35px",
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
    },
    "window_position": "top",
    "weather": {
        "latitude": 30.7522,
        "longitude": 120.75,
        "city_name": "嘉兴"
    }
}

var settings = JSON.parse(JSON.stringify(_settings))
