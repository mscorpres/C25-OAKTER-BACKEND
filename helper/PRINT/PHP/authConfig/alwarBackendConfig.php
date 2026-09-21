<?php
    date_default_timezone_set('Asia/Kolkata');
    
    define('DB_OAKTER_HOST',"138.201.35.175"); 
    define('DB_OAKTER_USER',"usr_oakter_ims");
    define('DB_OAKTER_PASS',"%89s1r5Uqp%3r6uD37");
    
    define('DB_OAKTER_INVT', 'c25_ims_invt');
    define('DB_OAKTER_TALLY', 'c25_ims_finance');
    
    // Establish DB Connection
    
    
    try {
        $con = new PDO("mysql:host=" . DB_OAKTER_HOST . ";charset=UTF8;dbname=" . DB_OAKTER_INVT, DB_OAKTER_USER, DB_OAKTER_PASS);
    } catch (PDOException $e) {
        echo 'We are not able to connect Inventory';
        exit;
    }
    
     try {
        $con_tally = new PDO("mysql:host=" . DB_OAKTER_HOST . ";charset=UTF8;dbname=" . DB_OAKTER_TALLY, DB_OAKTER_USER, DB_OAKTER_PASS);
    } catch (PDOException $e) {
        echo 'We are not able to connect Inventory';
        exit;
    }
?>
