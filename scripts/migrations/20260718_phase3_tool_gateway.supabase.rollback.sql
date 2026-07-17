alter table public.messages drop column if exists metadata;
drop table if exists public.integration_user_credentials;
drop table if exists public.integration_tool_executions;
drop table if exists public.integration_tools;
