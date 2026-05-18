#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive(tracing::Level::INFO.into()),
        )
        .init();
    let port = std::env::var("PORT").unwrap_or_else(|_| "8086".to_string());
    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    tracing::info!("mrp-engine listening on {}", addr);
    axum::serve(listener, mrp_engine::router()).await.unwrap();
}
