// Verifies actual deprecated bootstrap assets across fresh installs and update modes.
#[test]
fn deprecated_guides_replace_installed_workflows_only_on_update() {
    let base =
        std::env::temp_dir().join(format!("overdare-deprecated-guides-{}", std::process::id()));
    let _ = fs::remove_dir_all(&base);
    let bootstrap = Path::new(env!("CARGO_MANIFEST_DIR")).join("bootstrap");
    for (kind, filename) in [("skills", "SKILL.md"), ("agents", "AGENT.md")] {
        let src = bootstrap.join(kind);
        let dest = base.join(kind);
        let staging = base.join(".staging");
        let mut log = String::new();
        for name in ["procedural-builder", "geometry-recipe"] {
            write(&dest.join(name).join(filename), "old workflow instructions");
        }
        write(&dest.join("my-custom-entry").join(filename), "user content");
        deploy_managed_dir(&src, &dest, &staging, &mut log, DeployMode::MissingOnly).unwrap();
        for name in ["procedural-builder", "geometry-recipe"] {
            assert_eq!(
                fs::read_to_string(dest.join(name).join(filename)).unwrap(),
                "old workflow instructions"
            );
        }
        deploy_managed_dir(&src, &dest, &staging, &mut log, DeployMode::FullSync).unwrap();
        for name in ["procedural-builder", "geometry-recipe"] {
            let expected = fs::read_to_string(src.join(name).join(filename)).unwrap();
            assert!(expected.contains("Deprecated"));
            assert!(expected.contains("ProceduralModel"));
            assert!(expected.contains("studiorpc_execute_luau"));
            assert!(!expected.contains("studiorpc_procedural_run"));
            assert!(!expected.contains("studiorpc_proceduralmodel_"));
            assert_eq!(
                fs::read_to_string(dest.join(name).join(filename)).unwrap(),
                expected
            );
        }
        assert_eq!(
            fs::read_to_string(dest.join("my-custom-entry").join(filename)).unwrap(),
            "user content"
        );
        let fresh = base.join(format!("fresh-{kind}"));
        deploy_managed_dir(&src, &fresh, &staging, &mut log, DeployMode::MissingOnly).unwrap();
        for name in ["procedural-builder", "geometry-recipe"] {
            assert_eq!(
                fs::read_to_string(fresh.join(name).join(filename)).unwrap(),
                fs::read_to_string(src.join(name).join(filename)).unwrap()
            );
        }
    }
    let _ = fs::remove_dir_all(base);
}
