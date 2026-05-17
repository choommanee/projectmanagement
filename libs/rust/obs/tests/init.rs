#[test]
fn init_is_idempotent() {
    obs::init("test");
    obs::init("test"); // must not panic
}
