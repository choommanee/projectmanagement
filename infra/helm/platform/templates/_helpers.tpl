{{/* Common labels */}}
{{- define "platform.labels" -}}
app.kubernetes.io/managed-by: helm
app.kubernetes.io/part-of: platform
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}
