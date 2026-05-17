use sqlx::{postgres::PgPoolOptions, Pool, Postgres};

pub type PgPool = Pool<Postgres>;

pub async fn new_pool(dsn: &str) -> anyhow::Result<PgPool> {
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(dsn)
        .await?;
    Ok(pool)
}
