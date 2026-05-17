#[tokio::test]
async fn connect_and_ping() {
    let dsn = std::env::var("TEST_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://app:app@localhost:5432/platform".to_string());
    let Ok(pool) = db::new_pool(&dsn).await else {
        eprintln!("postgres unavailable, skipping");
        return;
    };
    let one: (i32,) = sqlx::query_as("SELECT 1").fetch_one(&pool).await.unwrap();
    assert_eq!(one.0, 1);
}
