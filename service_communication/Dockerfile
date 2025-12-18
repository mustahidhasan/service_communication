FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    iputils-ping traceroute dnsutils mtr netcat-openbsd build-essential curl \
    snmp snmpd \
    && rm -rf /var/lib/apt/lists/*

# Install Python dependencies
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy project files
COPY . .

EXPOSE 8000

# Run collectstatic at container start, then Gunicorn
CMD ["sh", "-c", "python manage.py collectstatic --noinput && gunicorn service_communication.asgi:application --bind 0.0.0.0:8000 -k uvicorn.workers.UvicornWorker"]
