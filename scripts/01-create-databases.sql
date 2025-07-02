-- Create databases
SELECT 'CREATE DATABASE auth_db' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'auth_db')\gexec
SELECT 'CREATE DATABASE document_db' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'document_db')\gexec
SELECT 'CREATE DATABASE financial_db' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'financial_db')\gexec