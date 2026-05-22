{{/* Chart name */}}
{{- define "platform.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{/* Fully qualified app name for a given subcomponent. Usage: {{ include "platform.fullname" (dict "ctx" . "svc" "identity-svc") }} */}}
{{- define "platform.fullname" -}}
{{- $ctx := .ctx -}}
{{- $svc := .svc -}}
{{- $release := $ctx.Release.Name | trunc 40 | trimSuffix "-" -}}
{{- printf "%s-%s" $release $svc | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{/* Common labels */}}
{{- define "platform.labels" -}}
app.kubernetes.io/managed-by: {{ .Release.Service | default "Helm" }}
app.kubernetes.io/part-of: platform
app.kubernetes.io/instance: {{ .Release.Name }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}

{{/* Per-service labels. Usage: {{ include "platform.serviceLabels" (dict "ctx" . "svc" "identity-svc") }} */}}
{{- define "platform.serviceLabels" -}}
{{ include "platform.labels" .ctx }}
app.kubernetes.io/name: {{ .svc }}
app.kubernetes.io/component: {{ .svc }}
{{- end }}

{{/* Per-service selector labels. Usage: {{ include "platform.selectorLabels" (dict "ctx" . "svc" "identity-svc") }} */}}
{{- define "platform.selectorLabels" -}}
app.kubernetes.io/name: {{ .svc }}
app.kubernetes.io/instance: {{ .ctx.Release.Name }}
{{- end }}
