use std::sync::Once;
use tracing_subscriber::{fmt, EnvFilter};

static INIT: Once = Once::new();

pub fn init(service: &str) {
    INIT.call_once(|| {
        let filter = EnvFilter::try_from_default_env()
            .unwrap_or_else(|_| EnvFilter::new("info"));
        fmt()
            .with_env_filter(filter)
            .json()
            .with_current_span(true)
            .with_target(true)
            .init();
        tracing::info!(service, "obs initialized");
    });
}
