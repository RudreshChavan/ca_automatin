#!/bin/bash
cd DaM/backend
export PYTHONPATH=.
python -c 'from database import init_db; init_db()'
gunicorn -w 4 -b 0.0.0.0:$PORT 'app:create_app()'
