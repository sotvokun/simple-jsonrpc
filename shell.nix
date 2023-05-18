{ pkgs ? import <nixpkgs> {} }:
  pkgs.mkShell {
    packages = [
      pkgs.nodejs-18_x
    ];
  }
