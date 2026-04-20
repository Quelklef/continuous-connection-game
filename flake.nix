{
  inputs =
    {
      nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
      shelpers.url = "gitlab:platonic/shelpers";
    };

  outputs = inputs:
    let
      system = "x86_64-linux";
      p = inputs.nixpkgs.legacyPackages.${system};

      shelpers = (inputs.shelpers.lib p).eval-shelpers [
        ({ shelp, ... }: {
          shelpers."."."General" = {
            inherit shelp;

            client = {
              description = "run the dev client";
              script = ''bun run dev --host'';
            };

            server = {
              description = "run the websocket";
              script = ''bun run server/server.js'';
            };
          };
        })
      ];
    in
    {
      devShells.${system}.default = p.mkShell {
        buildInputs = with p; [
          bun
          typescript
        ];

        shellHook = ''
          ${shelpers.functions}
          shelp
        '';
      };

      formatter.${system} = p.nixpkgs-fmt;
      apps.${system} = shelpers.apps;
      shelpers.${system} = shelpers.files;
    };
}
