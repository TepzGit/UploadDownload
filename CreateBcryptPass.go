package main

import (
	"fmt"
	"golang.org/x/crypto/bcrypt"
)

func createPass() {
	fmt.Print("Password: ")
	var password string
	fmt.Scan(&password)

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		fmt.Println("Could not hash password")
		return
	}

	fmt.Println(string(hashedPassword))
}

func main() {
	createPass()
}
